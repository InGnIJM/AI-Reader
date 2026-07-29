import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';

describe('code analysis database migration', () => {
  let directory = '';

  afterEach(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('merges duplicate projects, preserves every conversation, and allows local documents', () => {
    directory = mkdtempSync(join(tmpdir(), 'ai-reader-migration-'));
    const dbPath = join(directory, 'legacy.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
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
        status TEXT NOT NULL,
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
        ('doc-old', 'project-old', 'Old conversation', '# Old', 'completed', NULL, 0, '2026-07-28', '2026-07-28'),
        ('doc-new', 'project-new', 'New conversation', '# New', 'completed', NULL, 0, '2026-07-29', '2026-07-29');
      INSERT INTO analysis_tool_traces VALUES
        ('trace-1', 'doc-new', 0, 'readFile', '{}', 'kept', '2026-07-29');
      INSERT INTO analysis_annotations VALUES
        ('annotation-1', 'doc-new', 0, 3, 'New', '', '', 'Why?', 'answered', '2026-07-29', '2026-07-29');
      INSERT INTO analysis_discussion_messages VALUES
        ('message-1', 'annotation-1', 'assistant', 'Because.', NULL, '2026-07-29');
    `);
    legacy.close();

    const migrated = createDatabase(dbPath);
    const projects = migrated.db.prepare('SELECT id FROM code_projects').all();
    const documents = migrated.db
      .prepare('SELECT id, project_id AS projectId FROM analysis_documents ORDER BY id')
      .all() as Array<{ id: string; projectId: string | null }>;
    const projectIdColumn = migrated.db
      .prepare(
        `SELECT "notnull" AS isNotNull
         FROM pragma_table_info('analysis_documents')
         WHERE name = 'project_id'`,
      )
      .get() as { isNotNull: number };

    expect(projects).toHaveLength(1);
    expect(documents).toHaveLength(2);
    expect(new Set(documents.map((document) => document.projectId))).toHaveLength(1);
    expect(projectIdColumn.isNotNull).toBe(0);
    expect(
      migrated.db.prepare('SELECT COUNT(*) AS count FROM analysis_tool_traces').get(),
    ).toEqual({ count: 1 });
    expect(
      migrated.db.prepare('SELECT COUNT(*) AS count FROM analysis_annotations').get(),
    ).toEqual({ count: 1 });
    expect(
      migrated.db.prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages').get(),
    ).toEqual({ count: 1 });
    expect(migrated.db.pragma('foreign_key_check')).toEqual([]);
    expect(() =>
      migrated.db
        .prepare(
          `INSERT INTO analysis_documents
            (id, project_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
           VALUES ('doc-local', NULL, 'Local', '# Local', 'completed', 0, '2026-07-29', '2026-07-29')`,
        )
        .run(),
    ).not.toThrow();
    migrated.close();
  });
});
