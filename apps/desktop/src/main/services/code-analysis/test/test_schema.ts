import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQL } from 'drizzle-orm';
import {
  getTableConfig,
  SQLiteSyncDialect,
  type SQLiteTable,
} from 'drizzle-orm/sqlite-core';

import * as schema from '../../../db/schema';
import { createDatabase, type DatabaseClient } from '../../../db/client';

const TRANSITIONAL_TABLES = [
  {
    exportName: 'analysisSessions',
    sqlName: 'analysis_sessions',
    columns: [
      'id',
      'project_id',
      'title',
      'status',
      'active_branch_id',
      'active_document_id',
      'archived_at',
      'created_at',
      'updated_at',
    ],
    nullable: [
      'project_id',
      'active_branch_id',
      'active_document_id',
      'archived_at',
    ],
    defaults: { status: 'active' },
  },
  {
    exportName: 'analysisBranches',
    sqlName: 'analysis_branches',
    columns: [
      'id',
      'session_id',
      'name',
      'parent_branch_id',
      'forked_from_document_id',
      'head_document_id',
      'created_at',
      'updated_at',
    ],
    nullable: [
      'parent_branch_id',
      'forked_from_document_id',
      'head_document_id',
    ],
    defaults: {},
  },
  {
    exportName: 'analysisDocuments',
    sqlName: 'analysis_documents',
    columns: [
      'id',
      'session_id',
      'branch_id',
      'parent_document_id',
      'goal',
      'content_markdown',
      'status',
      'model_id',
      'tool_call_count',
      'created_at',
      'updated_at',
    ],
    nullable: [
      'parent_document_id',
      'model_id',
    ],
    defaults: {
      content_markdown: '',
      status: 'pending',
      tool_call_count: 0,
    },
  },
  {
    exportName: 'analysisAnnotations',
    sqlName: 'analysis_annotations',
    columns: [
      'id',
      'analysis_document_id',
      'anchor_start_offset',
      'anchor_end_offset',
      'anchor_exact_text',
      'selected_text',
      'anchor_prefix',
      'anchor_suffix',
      'question',
      'status',
      'created_at',
      'updated_at',
    ],
    nullable: [],
    defaults: { selected_text: '', status: 'pending' },
  },
  {
    exportName: 'analysisFileCleanupQueue',
    sqlName: 'analysis_file_cleanup_queue',
    columns: [
      'id',
      'document_id',
      'relative_path',
      'attempts',
      'last_error',
      'created_at',
      'updated_at',
    ],
    nullable: ['last_error'],
    defaults: { attempts: 0 },
  },
] as const;

const INDEXED_TABLE_EXPORTS = [
  'codeProjects',
  'analysisSessions',
  'analysisBranches',
  'analysisDocuments',
  'analysisToolTraces',
  'analysisAnnotations',
  'analysisDiscussionMessages',
  'analysisFileCleanupQueue',
] as const;

const ALL_TABLE_EXPORTS = [
  'workspaces',
  'documents',
  'chapters',
  'generatedArticles',
  'generatedSections',
  'generationJobs',
  'annotations',
  'discussionMessages',
  'llmUsageRecords',
  'appSettings',
  ...INDEXED_TABLE_EXPORTS,
] as const;

const sqliteDialect = new SQLiteSyncDialect();

function exportedTable(exportName: string): SQLiteTable {
  const table = (schema as Record<string, unknown>)[exportName];
  expect(table, `missing Drizzle export ${exportName}`).toBeDefined();
  return table as SQLiteTable;
}

function sqlColumns(db: DatabaseClient, tableName: string) {
  return db.db.prepare('SELECT * FROM pragma_table_info(?)').all(tableName) as Array<{
    name: string;
    notnull: 0 | 1;
    pk: 0 | 1;
    dflt_value: string | null;
  }>;
}

function parseSqliteDefault(defaultValue: string): string | number {
  if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
    return defaultValue.slice(1, -1).replace(/''/g, "'");
  }

  const numericValue = Number(defaultValue);
  return Number.isNaN(numericValue) ? defaultValue : numericValue;
}

function drizzleIndexColumn(column: unknown) {
  if (column instanceof SQL) {
    const rendered = sqliteDialect.sqlToQuery(column, 'indexes').sql;
    const quotedNames = [...rendered.matchAll(/"([^"]+)"/g)].map(
      (match) => match[1],
    );

    return {
      name: quotedNames.at(-1),
      descending: /\bDESC\b/i.test(rendered),
    };
  }

  return {
    name: (column as { name: string }).name,
    descending: false,
  };
}

function statusCheckValues(checkSql: string): string[] {
  const valuesSql = checkSql.match(
    /(?:["`]?analysis_sessions["`]?\.)?["`]?status["`]?\s+IN\s*\(([^)]+)\)/i,
  )?.[1];

  return valuesSql
    ? [...valuesSql.matchAll(/'([^']+)'/g)].map((match) => match[1])
    : [];
}

describe('code-analysis database schema', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('keeps Drizzle table and column declarations aligned with fresh SQL', () => {
    for (const expected of TRANSITIONAL_TABLES) {
      const config = getTableConfig(exportedTable(expected.exportName));

      expect(config.name).toBe(expected.sqlName);
      expect(config.columns.map((column) => column.name)).toEqual(expected.columns);
      expect(sqlColumns(db, expected.sqlName).map((column) => column.name)).toEqual(
        expected.columns,
      );
    }
  });

  it('keeps transitional nullability and defaults aligned with fresh SQL', () => {
    for (const expected of TRANSITIONAL_TABLES) {
      const config = getTableConfig(exportedTable(expected.exportName));
      const drizzleNullable = config.columns
        .filter((column) => !column.notNull)
        .map((column) => column.name);
      const sqliteNullable = sqlColumns(db, expected.sqlName)
        .filter((column) => column.notnull === 0 && column.pk === 0)
        .map((column) => column.name);

      expect(drizzleNullable).toEqual(expected.nullable);
      expect(sqliteNullable).toEqual(expected.nullable);

      const drizzleDefaults = Object.fromEntries(
        config.columns
          .filter((column) => column.default !== undefined)
          .map((column) => [column.name, column.default]),
      );
      const sqliteDefaults = Object.fromEntries(
        sqlColumns(db, expected.sqlName)
          .filter(
            (
              column,
            ): column is typeof column & { dflt_value: string } =>
              column.dflt_value !== null,
          )
          .map((column) => [
            column.name,
            parseSqliteDefault(column.dflt_value),
          ]),
      );

      expect(drizzleDefaults).toEqual(expected.defaults);
      expect(sqliteDefaults).toEqual(expected.defaults);
    }

    expect(schema.analysisFileCleanupQueue.relativePath.isUnique).toBe(true);
    const cleanupUniqueIndexes = db.db
      .prepare(
        `SELECT name
         FROM pragma_index_list('analysis_file_cleanup_queue')
         WHERE "unique" = 1 AND origin = 'u'`,
      )
      .all() as Array<{ name: string }>;
    expect(cleanupUniqueIndexes).toHaveLength(1);
    expect(
      db.db
        .prepare('SELECT name FROM pragma_index_info(?)')
        .all(cleanupUniqueIndexes[0].name),
    ).toEqual([{ name: 'relative_path' }]);
  });

  it('declares analysis session status as the SQL enum domain', () => {
    expect(schema.analysisSessions.status.enumValues).toEqual([
      'active',
      'archived',
    ]);
  });

  it('declares the SQL status check and rejects invalid session status', () => {
    const checks = getTableConfig(schema.analysisSessions).checks;
    const sqliteTable = db.db
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'table' AND name = 'analysis_sessions'`,
      )
      .get() as { sql: string };

    expect(checks).toHaveLength(1);
    const drizzleCheckValues = statusCheckValues(
      sqliteDialect.sqlToQuery(checks[0].value).sql,
    );
    const sqliteCheckValues = statusCheckValues(sqliteTable.sql);
    expect(drizzleCheckValues).toEqual(sqliteCheckValues);
    expect(sqliteCheckValues).toEqual(['active', 'archived']);

    const now = new Date().toISOString();
    expect(() =>
      db.db
        .prepare(
          `INSERT INTO analysis_sessions
             (id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('session-invalid', 'Invalid', 'deleted', now, now),
    ).toThrow(/CHECK constraint failed/);
  });

  it('keeps Drizzle foreign keys and cascade actions aligned with fresh SQL', () => {
    for (const expected of TRANSITIONAL_TABLES) {
      const drizzleForeignKeys = getTableConfig(exportedTable(expected.exportName))
        .foreignKeys.map((foreignKey) => {
          const reference = foreignKey.reference();
          return {
            from: reference.columns[0].name,
            table: getTableConfig(reference.foreignTable).name,
            to: reference.foreignColumns[0].name,
            onDelete: foreignKey.onDelete ?? 'no action',
          };
        })
        .sort((left, right) => left.from.localeCompare(right.from));
      const sqliteForeignKeys = (
        db.db.prepare('SELECT * FROM pragma_foreign_key_list(?)').all(
          expected.sqlName,
        ) as Array<{
          from: string;
          table: string;
          to: string;
          on_delete: string;
        }>
      )
        .map((foreignKey) => ({
          from: foreignKey.from,
          table: foreignKey.table,
          to: foreignKey.to,
          onDelete: foreignKey.on_delete.toLowerCase(),
        }))
        .sort((left, right) => left.from.localeCompare(right.from));

      expect(drizzleForeignKeys).toEqual(sqliteForeignKeys);
    }
  });

  it('resolves every Drizzle foreign-key declaration', () => {
    for (const exportName of ALL_TABLE_EXPORTS) {
      for (const foreignKey of getTableConfig(exportedTable(exportName))
        .foreignKeys) {
        const reference = foreignKey.reference();

        expect(reference.columns).toHaveLength(1);
        expect(reference.foreignColumns).toHaveLength(1);
        expect(getTableConfig(reference.foreignTable).name).not.toBe('');
      }
    }
  });

  it('matches transitional SQL index columns, order, uniqueness, and direction', () => {
    const drizzleIndexes = INDEXED_TABLE_EXPORTS.flatMap((exportName) => {
      const tableConfig = getTableConfig(exportedTable(exportName));
      return tableConfig.indexes.map((tableIndex) => ({
        name: tableIndex.config.name,
        table: tableConfig.name,
        unique: tableIndex.config.unique,
        columns: tableIndex.config.columns.map(drizzleIndexColumn),
      }));
    }).sort((left, right) => left.name.localeCompare(right.name));
    const sqliteIndexRows = (
      db.db
        .prepare(
          `SELECT name, tbl_name AS tableName
           FROM sqlite_master
           WHERE type = 'index'
             AND (name LIKE 'idx_analysis_%' OR name = 'ux_code_projects_root_path_hash')
           ORDER BY name`,
        )
        .all() as Array<{ name: string; tableName: string }>
    );
    const sqliteIndexes = sqliteIndexRows.map(({ name, tableName }) => {
      const indexListRow = db.db
        .prepare(
          `SELECT "unique" AS isUnique
           FROM pragma_index_list(?)
           WHERE name = ?`,
        )
        .get(tableName, name) as { isUnique: 0 | 1 };
      const columns = db.db
        .prepare(
          `SELECT name, "desc" AS descending
           FROM pragma_index_xinfo(?)
           WHERE key = 1
           ORDER BY seqno`,
        )
        .all(name) as Array<{ name: string; descending: 0 | 1 }>;

      return {
        name,
        table: tableName,
        unique: indexListRow.isUnique === 1,
        columns: columns.map((column) => ({
          name: column.name,
          descending: column.descending === 1,
        })),
      };
    });

    expect(drizzleIndexes).toEqual(sqliteIndexes);
  });

  it('uses the selected_text transitional default when omitted', () => {
    const now = new Date().toISOString();

    db.db.prepare(`
      INSERT INTO analysis_sessions (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('session-default', 'Default Session', now, now);
    db.db.prepare(`
      INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('branch-default', 'session-default', 'Main', now, now);
    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('doc-default', 'session-default', 'branch-default', 'Default selected text', now, now);
    db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset,
         anchor_exact_text, anchor_prefix, anchor_suffix, question, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ann-default', 'doc-default', 0, 4, 'text', '', '', 'Why?', now, now);

    expect(
      db.db
        .prepare(
          'SELECT selected_text AS selectedText FROM analysis_annotations WHERE id = ?',
        )
        .get('ann-default'),
    ).toEqual({ selectedText: '' });
  });

  it('cascades session turns while cleanup queue rows survive turn and session deletion', () => {
    const now = new Date().toISOString();

    db.db.prepare(`
      INSERT INTO analysis_sessions
        (id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('session-1', 'Session', now, now);
    db.db.prepare(`
      INSERT INTO analysis_branches
        (id, session_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('branch-1', 'session-1', 'Main', now, now);
    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('turn-direct', 'session-1', 'branch-1', 'Direct delete', now, now);
    db.db.prepare(`
      INSERT INTO analysis_file_cleanup_queue
        (id, document_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'cleanup-direct',
      'turn-direct',
      'generated-documents/turn-direct',
      now,
      now,
    );

    db.db.prepare('DELETE FROM analysis_documents WHERE id = ?').run('turn-direct');

    expect(
      db.db
        .prepare('SELECT document_id FROM analysis_file_cleanup_queue WHERE id = ?')
        .get('cleanup-direct'),
    ).toEqual({ document_id: 'turn-direct' });

    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('turn-session', 'session-1', 'branch-1', 'Session delete', now, now);
    db.db.prepare(`
      INSERT INTO analysis_file_cleanup_queue
        (id, document_id, relative_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'cleanup-session',
      'turn-session',
      'generated-documents/turn-session',
      now,
      now,
    );

    db.db.prepare('DELETE FROM analysis_sessions WHERE id = ?').run('session-1');

    expect(
      db.db.prepare('SELECT COUNT(*) AS count FROM analysis_branches').get(),
    ).toEqual({ count: 0 });
    expect(
      db.db.prepare('SELECT COUNT(*) AS count FROM analysis_documents').get(),
    ).toEqual({ count: 0 });
    expect(
      db.db
        .prepare(
          `SELECT id, document_id AS documentId, relative_path AS relativePath
           FROM analysis_file_cleanup_queue
           ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: 'cleanup-direct',
        documentId: 'turn-direct',
        relativePath: 'generated-documents/turn-direct',
      },
      {
        id: 'cleanup-session',
        documentId: 'turn-session',
        relativePath: 'generated-documents/turn-session',
      },
    ]);
    expect(db.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('creates code analysis tables and cascades document children', () => {
    const now = new Date().toISOString();

    db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('project-1', 'AI-Reader', 'E:/code/AI-Reader', 'hash-1', now, now);
    db.db.prepare(`
      INSERT INTO analysis_sessions (id, project_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('session-1', 'project-1', 'Test Session', now, now);
    db.db.prepare(`
      INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('branch-1', 'session-1', 'Main', now, now);

    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('doc-1', 'session-1', 'branch-1', 'Analyze architecture', '# Result', 'completed', 'gpt-test', 2, now, now);

    db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('trace-1', 'doc-1', 0, 'listFiles', '{}', 'package.json', now);

    db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ann-1', 'doc-1', 0, 6, 'Result', '# ', '', 'Explain this', 'answered', now, now);

    db.db.prepare(`
      INSERT INTO analysis_discussion_messages
        (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('msg-1', 'ann-1', 'assistant', 'Explanation', 'gpt-test', now);

    db.db.prepare('DELETE FROM analysis_documents WHERE id = ?').run('doc-1');

    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_tool_traces').get()).toEqual({ count: 0 });
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_annotations').get()).toEqual({ count: 0 });
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages').get()).toEqual({ count: 0 });
  });
});
