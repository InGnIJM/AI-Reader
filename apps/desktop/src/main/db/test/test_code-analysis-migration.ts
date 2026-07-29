import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hashProjectRootPath,
  migrateCodeAnalysisSchema,
  normalizeProjectRootPath,
  type CodeAnalysisMigrationOptions,
} from '../code-analysis-migration';
import { createDatabase } from '../client';

interface SessionRow {
  id: string;
  projectId: string | null;
  title: string;
  activeBranchId: string | null;
  activeDocumentId: string | null;
}

interface BranchRow {
  id: string;
  sessionId: string;
  name: string;
  parentBranchId: string | null;
  forkedFromDocumentId: string | null;
  headDocumentId: string | null;
}

interface DocumentRow {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  branchId: string | null;
  parentDocumentId: string | null;
}

const REQUIRED_TRIGGER_NAMES = [
  'trg_analysis_branches_validate_insert',
  'trg_analysis_branches_validate_update',
  'trg_analysis_documents_validate_insert',
  'trg_analysis_documents_validate_update',
  'trg_analysis_sessions_validate_insert',
  'trg_analysis_sessions_validate_update',
];

describe('code analysis database migration', () => {
  let directory = '';
  const connections: Database.Database[] = [];

  afterEach(() => {
    for (const connection of connections) {
      if (connection.open) connection.close();
    }
    connections.length = 0;
    if (directory) rmSync(directory, { recursive: true, force: true });
    directory = '';
  });

  function track(connection: Database.Database): Database.Database {
    connections.push(connection);
    return connection;
  }

  function createPath(): string {
    directory = mkdtempSync(join(tmpdir(), 'ai-reader-migration-'));
    return join(directory, 'legacy.db');
  }

  function createLegacyDatabase(dbPath: string, marker?: string): Database.Database {
    const legacy = track(new Database(dbPath));
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE code_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        root_path_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE analysis_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE,
        goal TEXT NOT NULL,
        content_markdown TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        model_id TEXT,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE analysis_tool_traces (
        id TEXT PRIMARY KEY,
        analysis_document_id TEXT NOT NULL REFERENCES analysis_documents(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        tool_args_json TEXT NOT NULL,
        result_summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE analysis_annotations (
        id TEXT PRIMARY KEY,
        analysis_document_id TEXT NOT NULL REFERENCES analysis_documents(id) ON DELETE CASCADE,
        anchor_start_offset INTEGER NOT NULL,
        anchor_end_offset INTEGER NOT NULL,
        anchor_exact_text TEXT NOT NULL,
        anchor_prefix TEXT NOT NULL,
        anchor_suffix TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE analysis_discussion_messages (
        id TEXT PRIMARY KEY,
        annotation_id TEXT NOT NULL REFERENCES analysis_annotations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_id TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO code_projects VALUES
        ('project-old', 'AI-Reader', 'E:\\code\\AI-Reader', 'legacy-a', '2026-07-28', '2026-07-28'),
        ('project-new', 'AI-Reader', 'e:/code/AI-Reader/', 'legacy-b', '2026-07-29', '2026-07-29');
      INSERT INTO analysis_documents VALUES
        ('doc-old', 'project-old', 'Old conversation', '# Old', 'completed', NULL, 1, '2026-07-28', '2026-07-28'),
        ('doc-new', 'project-new', 'New conversation', '# New', 'completed', NULL, 1, '2026-07-29', '2026-07-29');
      INSERT INTO analysis_tool_traces VALUES
        ('trace-old', 'doc-old', 0, 'readFile', '{}', 'old kept', '2026-07-28'),
        ('trace-new', 'doc-new', 0, 'readFile', '{}', 'new kept', '2026-07-29');
      INSERT INTO analysis_annotations VALUES
        ('annotation-old', 'doc-old', 0, 3, 'Old', '', '', 'Why old?', 'answered', '2026-07-28', '2026-07-28'),
        ('annotation-new', 'doc-new', 0, 3, 'New', '', '', 'Why new?', 'answered', '2026-07-29', '2026-07-29');
      INSERT INTO analysis_discussion_messages VALUES
        ('reply-old', 'annotation-old', 'assistant', 'Old reply.', NULL, '2026-07-28'),
        ('reply-new', 'annotation-new', 'assistant', 'New reply.', NULL, '2026-07-29');
    `);
    if (marker !== undefined) {
      legacy
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (?, ?, ?)`,
        )
        .run('code_analysis_session_schema', marker, '2026-07-28');
    }
    return legacy;
  }

  function openMigrated(dbPath: string): Database.Database {
    const client = createDatabase(dbPath);
    return track(client.db);
  }

  function listIds(sqlite: Database.Database, table: string): string[] {
    return (
      sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{ id: string }>
    ).map(({ id }) => id);
  }

  function listTriggerNames(sqlite: Database.Database): string[] {
    return (
      sqlite
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'trigger' AND name LIKE 'trg_analysis_%'
           ORDER BY name`,
        )
        .all() as Array<{ name: string }>
    ).map(({ name }) => name);
  }

  function wrapDatabase(
    sqlite: Database.Database,
    overrides: {
      exec?: (sql: string) => unknown;
      pragma?: (source: string, options?: { simple?: boolean }) => unknown;
    },
  ): Database.Database {
    const runPragma = sqlite.pragma.bind(sqlite) as (
      source: string,
      options?: { simple?: boolean },
    ) => unknown;
    return {
      get inTransaction() {
        return sqlite.inTransaction;
      },
      exec: overrides.exec ?? sqlite.exec.bind(sqlite),
      prepare: sqlite.prepare.bind(sqlite),
      pragma: overrides.pragma ?? runPragma,
    } as unknown as Database.Database;
  }

  function seedSessionGraph(sqlite: Database.Database): void {
    const insertSession = sqlite.prepare(`
      INSERT INTO analysis_sessions
        (id, project_id, title, status, active_branch_id, active_document_id,
         archived_at, created_at, updated_at)
      VALUES (?, NULL, ?, 'active', NULL, NULL, NULL, '2026-07-29', '2026-07-29')
    `);
    const insertBranch = sqlite.prepare(`
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id,
         head_document_id, created_at, updated_at)
      VALUES (?, ?, 'Main', NULL, NULL, NULL, '2026-07-29', '2026-07-29')
    `);
    const insertDocument = sqlite.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, session_id, branch_id, parent_document_id, goal,
         content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES (?, NULL, ?, ?, NULL, ?, '', 'completed', 0, '2026-07-29', '2026-07-29')
    `);

    for (const suffix of ['one', 'two']) {
      insertSession.run(`session-${suffix}`, `Session ${suffix}`);
      insertBranch.run(`branch-${suffix}`, `session-${suffix}`);
      insertDocument.run(
        `document-${suffix}`,
        `session-${suffix}`,
        `branch-${suffix}`,
        `Goal ${suffix}`,
      );
      sqlite
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(`document-${suffix}`, `branch-${suffix}`);
      sqlite
        .prepare(
          `UPDATE analysis_sessions
           SET active_branch_id = ?, active_document_id = ?
           WHERE id = ?`,
        )
        .run(`branch-${suffix}`, `document-${suffix}`, `session-${suffix}`);
    }
  }

  it('migrates each legacy document into its own session and main branch without changing IDs', () => {
    const dbPath = createPath();
    createLegacyDatabase(dbPath).close();

    const sqlite = openMigrated(dbPath);
    const sessions = sqlite
      .prepare(
        `SELECT id, project_id AS projectId, title,
                active_branch_id AS activeBranchId,
                active_document_id AS activeDocumentId
         FROM analysis_sessions
         ORDER BY title`,
      )
      .all() as SessionRow[];
    const branches = sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, name,
                parent_branch_id AS parentBranchId,
                forked_from_document_id AS forkedFromDocumentId,
                head_document_id AS headDocumentId
         FROM analysis_branches
         ORDER BY head_document_id`,
      )
      .all() as BranchRow[];
    const documents = sqlite
      .prepare(
        `SELECT id, project_id AS projectId, session_id AS sessionId,
                branch_id AS branchId, parent_document_id AS parentDocumentId
         FROM analysis_documents
         ORDER BY id`,
      )
      .all() as DocumentRow[];

    expect(sessions).toHaveLength(2);
    expect(branches).toHaveLength(2);
    expect(documents).toHaveLength(2);
    for (const document of documents) {
      const session = sessions.find(({ id }) => id === document.sessionId);
      const branch = branches.find(({ id }) => id === document.branchId);
      expect(session).toMatchObject({
        projectId: document.projectId,
        activeBranchId: document.branchId,
        activeDocumentId: document.id,
      });
      expect(branch).toMatchObject({
        sessionId: document.sessionId,
        name: '主分支',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: document.id,
      });
      expect(document.parentDocumentId).toBeNull();
    }
    expect(sessions.map(({ title }) => title).sort()).toEqual([
      'New conversation',
      'Old conversation',
    ]);

    expect(sqlite.prepare('SELECT id FROM code_projects').all()).toHaveLength(1);
    expect(new Set(documents.map(({ projectId }) => projectId))).toHaveLength(1);
    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(listIds(sqlite, 'analysis_annotations')).toEqual([
      'annotation-new',
      'annotation-old',
    ]);
    expect(listIds(sqlite, 'analysis_discussion_messages')).toEqual([
      'reply-new',
      'reply-old',
    ]);
    expect(listIds(sqlite, 'analysis_tool_traces')).toEqual([
      'trace-new',
      'trace-old',
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT selected_text AS selectedText
           FROM analysis_annotations
           ORDER BY id`,
        )
        .all(),
    ).toEqual([{ selectedText: 'New' }, { selectedText: 'Old' }]);
    expect(
      sqlite
        .prepare(
          `SELECT value FROM app_settings
           WHERE key = ?`,
        )
        .get('code_analysis_session_schema'),
    ).toEqual({ value: '1' });
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'analysis_file_cleanup_queue'`,
        )
        .get(),
    ).toEqual({ name: 'analysis_file_cleanup_queue' });

    const documentColumns = sqlite
      .prepare(
        `SELECT name, "notnull" AS isNotNull
         FROM pragma_table_info('analysis_documents')
         WHERE name IN ('project_id', 'session_id', 'branch_id')
         ORDER BY name`,
      )
      .all();
    expect(documentColumns).toEqual([
      { name: 'branch_id', isNotNull: 0 },
      { name: 'project_id', isNotNull: 0 },
      { name: 'session_id', isNotNull: 0 },
    ]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO analysis_documents
            (id, project_id, goal, content_markdown, status, tool_call_count,
             created_at, updated_at)
           VALUES (?, NULL, ?, ?, 'completed', 0, ?, ?)`,
        )
        .run(
          'doc-local',
          'Local',
          '# Local',
          '2026-07-29',
          '2026-07-29',
        ),
    ).not.toThrow();
  });

  it('rejects cross-session active branch and document pointers', () => {
    const sqlite = openMigrated(createPath());
    seedSessionGraph(sqlite);

    expect(() =>
      sqlite
        .prepare('UPDATE analysis_sessions SET active_branch_id = ? WHERE id = ?')
        .run('branch-two', 'session-one'),
    ).toThrow(/session/i);
    expect(() =>
      sqlite
        .prepare('UPDATE analysis_sessions SET active_document_id = ? WHERE id = ?')
        .run('document-two', 'session-one'),
    ).toThrow(/session/i);
  });

  it('rejects turn and branch session mismatches', () => {
    const sqlite = openMigrated(createPath());
    seedSessionGraph(sqlite);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO analysis_documents
            (id, project_id, session_id, branch_id, parent_document_id, goal,
             content_markdown, status, tool_call_count, created_at, updated_at)
           VALUES (?, NULL, ?, ?, NULL, ?, '', 'completed', 0, ?, ?)`,
        )
        .run(
          'document-invalid',
          'session-one',
          'branch-two',
          'Invalid',
          '2026-07-29',
          '2026-07-29',
        ),
    ).toThrow(/session/i);
    expect(() =>
      sqlite
        .prepare('UPDATE analysis_documents SET branch_id = ? WHERE id = ?')
        .run('branch-two', 'document-one'),
    ).toThrow(/session/i);
  });

  it('rejects cross-session branch, fork, and turn parents', () => {
    const sqlite = openMigrated(createPath());
    seedSessionGraph(sqlite);

    const insertBranch = sqlite.prepare(`
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id,
         head_document_id, created_at, updated_at)
      VALUES (?, 'session-one', 'Invalid', ?, ?, NULL, '2026-07-29', '2026-07-29')
    `);
    expect(() => insertBranch.run('branch-parent-invalid', 'branch-two', null)).toThrow(
      /session/i,
    );
    expect(() =>
      insertBranch.run('branch-fork-invalid', null, 'document-two'),
    ).toThrow(/session/i);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO analysis_documents
            (id, project_id, session_id, branch_id, parent_document_id, goal,
             content_markdown, status, tool_call_count, created_at, updated_at)
           VALUES (?, NULL, 'session-one', 'branch-one', 'document-two', ?,
                   '', 'completed', 0, '2026-07-29', '2026-07-29')`,
        )
        .run('document-parent-invalid', 'Invalid'),
    ).toThrow(/session/i);
  });

  it('rejects self-referencing and indirect turn parent cycles', () => {
    const sqlite = openMigrated(createPath());
    seedSessionGraph(sqlite);

    expect(() =>
      sqlite
        .prepare('UPDATE analysis_documents SET parent_document_id = id WHERE id = ?')
        .run('document-one'),
    ).toThrow(/cycle/i);

    sqlite
      .prepare(
        `INSERT INTO analysis_documents
          (id, project_id, session_id, branch_id, parent_document_id, goal,
           content_markdown, status, tool_call_count, created_at, updated_at)
         VALUES ('document-child', NULL, 'session-one', 'branch-one',
                 'document-one', 'Child', '', 'completed', 0,
                 '2026-07-29', '2026-07-29')`,
      )
      .run();
    expect(() =>
      sqlite
        .prepare('UPDATE analysis_documents SET parent_document_id = ? WHERE id = ?')
        .run('document-child', 'document-one'),
    ).toThrow(/cycle/i);
  });

  it('rejects branch heads owned by another branch', () => {
    const sqlite = openMigrated(createPath());
    seedSessionGraph(sqlite);

    expect(() =>
      sqlite
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run('document-two', 'branch-one'),
    ).toThrow(/branch/i);
  });

  it('rejects reverse ownership mutations of referenced documents', () => {
    const moveToSessionTwo = (sqlite: Database.Database): void => {
      sqlite
        .prepare(
          `UPDATE analysis_documents
           SET session_id = 'session-two', branch_id = 'branch-two'
           WHERE id = 'document-one'`,
        )
        .run();
    };

    const activeDocumentDb = openMigrated(':memory:');
    seedSessionGraph(activeDocumentDb);
    activeDocumentDb
      .prepare('UPDATE analysis_branches SET head_document_id = NULL WHERE id = ?')
      .run('branch-one');
    expect(() => moveToSessionTwo(activeDocumentDb)).toThrow(/active document/i);
    expect(activeDocumentDb.pragma('foreign_key_check')).toEqual([]);

    const branchHeadDb = openMigrated(':memory:');
    seedSessionGraph(branchHeadDb);
    branchHeadDb
      .prepare('UPDATE analysis_sessions SET active_document_id = NULL WHERE id = ?')
      .run('session-one');
    expect(() => moveToSessionTwo(branchHeadDb)).toThrow(/head/i);
    expect(branchHeadDb.pragma('foreign_key_check')).toEqual([]);

    const forkDocumentDb = openMigrated(':memory:');
    seedSessionGraph(forkDocumentDb);
    forkDocumentDb.exec(`
      UPDATE analysis_sessions
      SET active_document_id = NULL
      WHERE id = 'session-one';
      UPDATE analysis_branches
      SET head_document_id = NULL
      WHERE id = 'branch-one';
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id,
         head_document_id, created_at, updated_at)
      VALUES
        ('branch-child', 'session-one', 'Child', 'branch-one', 'document-one',
         NULL, '2026-07-29', '2026-07-29');
    `);
    expect(() => moveToSessionTwo(forkDocumentDb)).toThrow(/fork document/i);
    expect(forkDocumentDb.pragma('foreign_key_check')).toEqual([]);

    const parentDocumentDb = openMigrated(':memory:');
    seedSessionGraph(parentDocumentDb);
    parentDocumentDb.exec(`
      UPDATE analysis_sessions
      SET active_document_id = NULL
      WHERE id = 'session-one';
      UPDATE analysis_branches
      SET head_document_id = NULL
      WHERE id = 'branch-one';
      INSERT INTO analysis_documents
        (id, project_id, session_id, branch_id, parent_document_id, goal,
         content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES
        ('document-child', NULL, 'session-one', 'branch-one', 'document-one',
         'Child', '', 'completed', 0, '2026-07-29', '2026-07-29');
    `);
    expect(() => moveToSessionTwo(parentDocumentDb)).toThrow(/child parent/i);
    expect(parentDocumentDb.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects reverse ownership mutations of referenced branches', () => {
    const moveToSessionTwo = (sqlite: Database.Database): void => {
      sqlite
        .prepare(
          `UPDATE analysis_branches
           SET session_id = 'session-two'
           WHERE id = 'branch-one'`,
        )
        .run();
    };
    const detachDocument = (sqlite: Database.Database): void => {
      sqlite.exec(`
        UPDATE analysis_sessions
        SET active_document_id = NULL
        WHERE id = 'session-one';
        UPDATE analysis_branches
        SET head_document_id = NULL
        WHERE id = 'branch-one';
        UPDATE analysis_documents
        SET branch_id = NULL
        WHERE id = 'document-one';
      `);
    };

    const activeBranchDb = openMigrated(':memory:');
    seedSessionGraph(activeBranchDb);
    detachDocument(activeBranchDb);
    expect(() => moveToSessionTwo(activeBranchDb)).toThrow(/active branch/i);
    expect(activeBranchDb.pragma('foreign_key_check')).toEqual([]);

    const parentBranchDb = openMigrated(':memory:');
    seedSessionGraph(parentBranchDb);
    parentBranchDb
      .prepare(
        `INSERT INTO analysis_branches
          (id, session_id, name, parent_branch_id, forked_from_document_id,
           head_document_id, created_at, updated_at)
         VALUES
          ('branch-child', 'session-one', 'Child', 'branch-one', NULL, NULL,
           '2026-07-29', '2026-07-29')`,
      )
      .run();
    parentBranchDb
      .prepare('UPDATE analysis_sessions SET active_branch_id = NULL WHERE id = ?')
      .run('session-one');
    detachDocument(parentBranchDb);
    expect(() => moveToSessionTwo(parentBranchDb)).toThrow(/child branch/i);
    expect(parentBranchDb.pragma('foreign_key_check')).toEqual([]);
  });

  it('is idempotent when the same v1 database is closed and reopened', () => {
    const dbPath = createPath();
    createLegacyDatabase(dbPath).close();
    const first = openMigrated(dbPath);
    const originalSessions = listIds(first, 'analysis_sessions');
    const originalBranches = listIds(first, 'analysis_branches');
    const originalDocuments = listIds(first, 'analysis_documents');
    expect(listTriggerNames(first)).toEqual(REQUIRED_TRIGGER_NAMES);
    first.close();

    const reopened = openMigrated(dbPath);

    expect(listIds(reopened, 'analysis_sessions')).toEqual(originalSessions);
    expect(listIds(reopened, 'analysis_branches')).toEqual(originalBranches);
    expect(listIds(reopened, 'analysis_documents')).toEqual(originalDocuments);
    expect(listTriggerNames(reopened)).toEqual(REQUIRED_TRIGGER_NAMES);
    expect(
      reopened
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toEqual({ value: '1' });
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
    expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects future schema versions without mutating the database', () => {
    const sqlite = createLegacyDatabase(createPath(), '2');
    const schemaBefore = sqlite
      .prepare(
        `SELECT type, name, sql
         FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all();
    const pragma = vi.spyOn(sqlite, 'pragma');

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(/newer schema version.*2/i);

    expect(
      sqlite
        .prepare(
          `SELECT type, name, sql
           FROM sqlite_master
           WHERE name NOT LIKE 'sqlite_%'
           ORDER BY type, name`,
        )
        .all(),
    ).toEqual(schemaBefore);
    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(
      pragma.mock.calls.some(([source]) => source === 'foreign_keys = OFF'),
    ).toBe(false);
    expect(
      sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toEqual({ value: '2' });
  });

  it('rejects an unsupported non-numeric schema marker', () => {
    const sqlite = createLegacyDatabase(createPath(), 'invalid');

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(
      /unsupported code analysis schema version.*invalid/i,
    );

    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects a stale v1 marker on a legacy schema', () => {
    const sqlite = createLegacyDatabase(createPath(), '1');
    const schemaBefore = sqlite
      .prepare(
        `SELECT type, name, sql
         FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all();

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(/invalid v1 schema/i);

    expect(
      sqlite
        .prepare(
          `SELECT type, name, sql
           FROM sqlite_master
           WHERE name NOT LIKE 'sqlite_%'
           ORDER BY type, name`,
        )
        .all(),
    ).toEqual(schemaBefore);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it.each([
    {
      name: 'table',
      damage: 'DROP TABLE analysis_file_cleanup_queue',
    },
    {
      name: 'column',
      damage: 'ALTER TABLE analysis_annotations DROP COLUMN selected_text',
    },
    {
      name: 'index',
      damage: 'DROP INDEX idx_analysis_documents_session',
    },
    {
      name: 'trigger',
      damage: 'DROP TRIGGER trg_analysis_documents_validate_update',
    },
    {
      name: 'trigger definition',
      damage: `
        DROP TRIGGER trg_analysis_documents_validate_update;
        CREATE TRIGGER trg_analysis_documents_validate_update
        BEFORE UPDATE ON analysis_documents
        BEGIN
          SELECT 1;
        END
      `,
    },
  ])('rejects an incomplete v1 schema with a missing or stale $name', ({ damage }) => {
    const sqlite = openMigrated(':memory:');
    sqlite.exec(damage);

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(/invalid v1 schema/i);
    expect(
      sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toEqual({ value: '1' });
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rolls back schema, data, deduplication, and the version marker on failure', () => {
    const sqlite = createLegacyDatabase(createPath(), '0');
    const previousTables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all();
    const options: CodeAnalysisMigrationOptions = {
      beforeCommit: () => {
        throw new Error('forced failure');
      },
    };

    expect(() => migrateCodeAnalysisSchema(sqlite, options)).toThrow('forced failure');

    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all(),
    ).toEqual(previousTables);
    expect(
      sqlite
        .prepare(
          `SELECT name, "notnull" AS isNotNull
           FROM pragma_table_info('analysis_documents')
           ORDER BY cid`,
        )
        .all(),
    ).not.toContainEqual({ name: 'session_id', isNotNull: 0 });
    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(listIds(sqlite, 'analysis_annotations')).toEqual([
      'annotation-new',
      'annotation-old',
    ]);
    expect(listIds(sqlite, 'analysis_discussion_messages')).toEqual([
      'reply-new',
      'reply-old',
    ]);
    expect(listIds(sqlite, 'analysis_tool_traces')).toEqual([
      'trace-new',
      'trace-old',
    ]);
    expect(sqlite.prepare('SELECT id FROM code_projects ORDER BY id').all()).toEqual([
      { id: 'project-new' },
      { id: 'project-old' },
    ]);
    expect(
      sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toEqual({ value: '0' });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rolls back when the pre-commit hook changes a preserved runtime count', () => {
    const sqlite = createLegacyDatabase(createPath());

    expect(() =>
      migrateCodeAnalysisSchema(sqlite, {
        beforeCommit: () => {
          sqlite.prepare('DELETE FROM analysis_tool_traces WHERE id = ?').run('trace-old');
        },
      }),
    ).toThrow(/analysis_tool_traces count changed/i);

    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(listIds(sqlite, 'analysis_annotations')).toEqual([
      'annotation-new',
      'annotation-old',
    ]);
    expect(listIds(sqlite, 'analysis_discussion_messages')).toEqual([
      'reply-new',
      'reply-old',
    ]);
    expect(listIds(sqlite, 'analysis_tool_traces')).toEqual([
      'trace-new',
      'trace-old',
    ]);
    expect(
      sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toBeUndefined();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('migrates empty project paths and empty goals using the legacy fallback behavior', () => {
    const sqlite = createLegacyDatabase(createPath());
    sqlite.exec(`
      INSERT INTO code_projects VALUES
        ('project-empty', 'Local', '', 'legacy-empty', '2026-07-30', '2026-07-30');
      INSERT INTO analysis_documents VALUES
        ('doc-empty', 'project-empty', '  ', '', 'completed', NULL, 0,
         '2026-07-30', '2026-07-30');
    `);

    migrateCodeAnalysisSchema(sqlite);

    expect(
      sqlite.prepare('SELECT project_id AS projectId FROM analysis_documents WHERE id = ?').get(
        'doc-empty',
      ),
    ).toEqual({ projectId: null });
    expect(
      sqlite
        .prepare(
          `SELECT title
           FROM analysis_sessions
           WHERE active_document_id = ?`,
        )
        .get('doc-empty'),
    ).toEqual({ title: 'Untitled conversation' });
    expect(sqlite.prepare('SELECT id FROM code_projects WHERE id = ?').get('project-empty')).toBe(
      undefined,
    );
  });

  it('rolls back when the pre-commit foreign key check finds legacy corruption', () => {
    const sqlite = createLegacyDatabase(createPath());
    sqlite.pragma('foreign_keys = OFF');
    sqlite
      .prepare('UPDATE analysis_documents SET project_id = ? WHERE id = ?')
      .run('missing-project', 'doc-old');
    sqlite.pragma('foreign_keys = ON');

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(/foreign key check/i);

    expect(listIds(sqlite, 'analysis_documents')).toEqual(['doc-new', 'doc-old']);
    expect(
      sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get('code_analysis_session_schema'),
    ).toBeUndefined();
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('creates a fresh transitional schema without a pre-existing settings table', () => {
    const sqlite = track(new Database(':memory:'));
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE code_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL,
        root_path_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    migrateCodeAnalysisSchema(sqlite);

    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN (
             'analysis_sessions',
             'analysis_branches',
             'analysis_documents',
             'analysis_file_cleanup_queue'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: 'analysis_branches' },
      { name: 'analysis_documents' },
      { name: 'analysis_file_cleanup_queue' },
      { name: 'analysis_sessions' },
    ]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('normalizes root paths and hashes paths according to the host platform', () => {
    expect(normalizeProjectRootPath('C:\\')).toBe('C:/');
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

    expect(hashProjectRootPath('E:/code/AI-Reader')).not.toBe(
      hashProjectRootPath('e:/code/AI-Reader'),
    );

    platform.mockRestore();
  });

  it('reports failure when SQLite cannot restore foreign key enforcement', () => {
    const realSqlite = openMigrated(':memory:');
    const runPragma = realSqlite.pragma.bind(realSqlite) as Database.Database['pragma'];
    const sqlite = wrapDatabase(realSqlite, {
      pragma: ((statement: string, options?: unknown) => {
        if (statement === 'foreign_keys') {
          return 0;
        }

        return runPragma(statement, options as never);
      }) as Database.Database['pragma'],
    });

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(
      'Failed to restore SQLite foreign key enforcement',
    );

    realSqlite.close();
  });

  it('verifies foreign keys are disabled before beginning destructive work', () => {
    const sqlite = createLegacyDatabase(createPath());
    let beginCalls = 0;
    const runPragma = sqlite.pragma.bind(sqlite) as (
      source: string,
      options?: { simple?: boolean },
    ) => unknown;
    const wrapped = wrapDatabase(sqlite, {
      exec: (sql) => {
        if (sql === 'BEGIN IMMEDIATE') beginCalls += 1;
        return sqlite.exec(sql);
      },
      pragma: (source, options) => {
        if (source === 'foreign_keys = OFF') return undefined;
        return runPragma(source, options);
      },
    });

    expect(() => migrateCodeAnalysisSchema(wrapped)).toThrow(
      /failed to disable SQLite foreign key enforcement/i,
    );

    expect(beginCalls).toBe(0);
    expect(
      sqlite
        .prepare(
          `SELECT name FROM pragma_table_info('analysis_documents')
           WHERE name = 'session_id'`,
        )
        .get(),
    ).toBeUndefined();
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('restores foreign keys when beginning the migration fails', () => {
    const sqlite = createLegacyDatabase(createPath());
    const wrapped = wrapDatabase(sqlite, {
      exec: (sql) => {
        if (sql === 'BEGIN IMMEDIATE') throw new Error('forced begin failure');
        return sqlite.exec(sql);
      },
    });

    expect(() => migrateCodeAnalysisSchema(wrapped)).toThrow('forced begin failure');

    expect(sqlite.inTransaction).toBe(false);
    expect(
      sqlite
        .prepare(
          `SELECT name FROM pragma_table_info('analysis_documents')
           WHERE name = 'session_id'`,
        )
        .get(),
    ).toBeUndefined();
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('closes a fresh database client', () => {
    const client = createDatabase(':memory:');

    client.close();

    expect(client.db.open).toBe(false);
  });

  it('requires an idle connection before changing foreign key enforcement', () => {
    const sqlite = createLegacyDatabase(createPath());
    sqlite.exec('BEGIN');

    expect(() => migrateCodeAnalysisSchema(sqlite)).toThrow(/idle/i);
    expect(sqlite.inTransaction).toBe(true);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);

    sqlite.exec('ROLLBACK');
  });
});
