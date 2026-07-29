import { createHash, randomUUID } from 'crypto';
import { parse, resolve } from 'path';
import type Database from 'better-sqlite3';

const SESSION_SCHEMA_KEY = 'code_analysis_session_schema';
const SESSION_SCHEMA_VERSION = '1';

interface ProjectRow {
  id: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentToMigrate {
  id: string;
  projectId: string | null;
  goal: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodeAnalysisMigrationOptions {
  beforeCommit?: () => void;
}

export function normalizeProjectRootPath(rootPath: string): string {
  const normalizedPath = resolve(rootPath).replace(/\\/g, '/');
  const normalizedRoot = parse(normalizedPath).root.replace(/\\/g, '/');
  return normalizedPath === normalizedRoot
    ? normalizedPath
    : normalizedPath.replace(/\/+$/, '');
}

export function hashProjectRootPath(rootPath: string): string {
  const normalized = normalizeProjectRootPath(rootPath);
  const comparablePath = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha256').update(comparablePath).digest('hex');
}

export function migrateCodeAnalysisSchema(
  sqlite: Database.Database,
  options: CodeAnalysisMigrationOptions = {},
): void {
  if (sqlite.inTransaction) {
    throw new Error('Code analysis migration requires an idle database connection');
  }

  if (readSchemaVersion(sqlite) === SESSION_SCHEMA_VERSION) {
    restoreForeignKeys(sqlite);
    return;
  }

  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.exec('BEGIN IMMEDIATE');

    createTransitionalTables(sqlite);
    const legacyShape = !hasColumn(sqlite, 'analysis_documents', 'session_id');
    if (legacyShape) rebuildLegacyDocuments(sqlite);

    mergeDuplicateProjects(sqlite);
    backfillLegacyDocuments(sqlite);
    addSelectedText(sqlite);
    createIndexes(sqlite);
    createOwnershipAndCycleTriggers(sqlite);

    const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[];
    if (foreignKeyErrors.length > 0) {
      throw new Error(
        `Code analysis migration failed foreign key check: ${JSON.stringify(
          foreignKeyErrors,
        )}`,
      );
    }

    writeSchemaVersion(sqlite);
    options.beforeCommit?.();
    sqlite.exec('COMMIT');
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    restoreForeignKeys(sqlite);
  }
}

function readSchemaVersion(sqlite: Database.Database): string | undefined {
  if (!hasTable(sqlite, 'app_settings')) return undefined;
  return (
    sqlite
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(SESSION_SCHEMA_KEY) as { value: string } | undefined
  )?.value;
}

function writeSchemaVersion(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(SESSION_SCHEMA_KEY, SESSION_SCHEMA_VERSION, new Date().toISOString());
}

function restoreForeignKeys(sqlite: Database.Database): void {
  sqlite.pragma('foreign_keys = ON');
  if (sqlite.pragma('foreign_keys', { simple: true }) !== 1) {
    throw new Error('Failed to restore SQLite foreign key enforcement');
  }
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return Boolean(
    sqlite
      .prepare(
        `SELECT 1
         FROM sqlite_master
         WHERE type = 'table' AND name = ?`,
      )
      .get(table),
  );
}

function hasColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
): boolean {
  return Boolean(
    sqlite
      .prepare(
        `SELECT 1
         FROM pragma_table_info(?)
         WHERE name = ?`,
      )
      .get(table, column),
  );
}

function createTransitionalTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      active_branch_id TEXT
        REFERENCES analysis_branches(id) ON DELETE SET NULL,
      active_document_id TEXT
        REFERENCES analysis_documents(id) ON DELETE SET NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_branches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
        REFERENCES analysis_sessions(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      parent_branch_id TEXT
        REFERENCES analysis_branches(id) ON DELETE SET NULL,
      forked_from_document_id TEXT
        REFERENCES analysis_documents(id) ON DELETE SET NULL,
      head_document_id TEXT
        REFERENCES analysis_documents(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES analysis_sessions(id) ON DELETE CASCADE,
      branch_id TEXT REFERENCES analysis_branches(id) ON DELETE CASCADE,
      parent_document_id TEXT
        REFERENCES analysis_documents(id) ON DELETE CASCADE,
      goal TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      model_id TEXT,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_tool_traces (
      id TEXT PRIMARY KEY,
      analysis_document_id TEXT NOT NULL
        REFERENCES analysis_documents(id) ON DELETE CASCADE,
      step_index INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      tool_args_json TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_annotations (
      id TEXT PRIMARY KEY,
      analysis_document_id TEXT NOT NULL
        REFERENCES analysis_documents(id) ON DELETE CASCADE,
      anchor_start_offset INTEGER NOT NULL,
      anchor_end_offset INTEGER NOT NULL,
      anchor_exact_text TEXT NOT NULL,
      selected_text TEXT NOT NULL DEFAULT '',
      anchor_prefix TEXT NOT NULL,
      anchor_suffix TEXT NOT NULL,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_discussion_messages (
      id TEXT PRIMARY KEY,
      annotation_id TEXT NOT NULL
        REFERENCES analysis_annotations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_file_cleanup_queue (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function rebuildLegacyDocuments(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE analysis_documents_new (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES analysis_sessions(id) ON DELETE CASCADE,
      branch_id TEXT REFERENCES analysis_branches(id) ON DELETE CASCADE,
      parent_document_id TEXT
        REFERENCES analysis_documents(id) ON DELETE CASCADE,
      goal TEXT NOT NULL,
      content_markdown TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      model_id TEXT,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO analysis_documents_new
      (id, project_id, session_id, branch_id, parent_document_id, goal,
       content_markdown, status, model_id, tool_call_count, created_at, updated_at)
    SELECT id, project_id, NULL, NULL, NULL, goal, content_markdown, status,
           model_id, tool_call_count, created_at, updated_at
    FROM analysis_documents;
    DROP TABLE analysis_documents;
    ALTER TABLE analysis_documents_new RENAME TO analysis_documents;
  `);
}

function mergeDuplicateProjects(sqlite: Database.Database): void {
  const projects = sqlite
    .prepare(
      `SELECT id, root_path AS rootPath, created_at AS createdAt, updated_at AS updatedAt
       FROM code_projects
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as ProjectRow[];
  const canonicalByHash = new Map<string, ProjectRow>();
  const moveDocuments = sqlite.prepare(
    'UPDATE analysis_documents SET project_id = ? WHERE project_id = ?',
  );
  const detachDocuments = sqlite.prepare(
    'UPDATE analysis_documents SET project_id = NULL WHERE project_id = ?',
  );
  const deleteProject = sqlite.prepare('DELETE FROM code_projects WHERE id = ?');
  const updateProject = sqlite.prepare(
    'UPDATE code_projects SET root_path = ?, root_path_hash = ?, updated_at = ? WHERE id = ?',
  );

  for (const project of projects) {
    if (!project.rootPath.trim()) {
      detachDocuments.run(project.id);
      deleteProject.run(project.id);
      continue;
    }

    const normalizedPath = normalizeProjectRootPath(project.rootPath);
    const rootPathHash = hashProjectRootPath(project.rootPath);
    const canonical = canonicalByHash.get(rootPathHash);
    if (!canonical) {
      canonicalByHash.set(rootPathHash, project);
      updateProject.run(normalizedPath, rootPathHash, project.updatedAt, project.id);
      continue;
    }

    moveDocuments.run(canonical.id, project.id);
    if (project.updatedAt > canonical.updatedAt) {
      canonical.updatedAt = project.updatedAt;
      updateProject.run(normalizedPath, rootPathHash, project.updatedAt, canonical.id);
    }
    deleteProject.run(project.id);
  }
}

function backfillLegacyDocuments(sqlite: Database.Database): void {
  const documents = sqlite
    .prepare(
      `SELECT id, project_id AS projectId, goal,
              created_at AS createdAt, updated_at AS updatedAt
       FROM analysis_documents
       WHERE session_id IS NULL OR branch_id IS NULL
       ORDER BY created_at, id`,
    )
    .all() as DocumentToMigrate[];
  const insertSession = sqlite.prepare(`
    INSERT INTO analysis_sessions
      (id, project_id, title, status, active_branch_id, active_document_id,
       archived_at, created_at, updated_at)
    VALUES (?, ?, ?, 'active', NULL, NULL, NULL, ?, ?)
  `);
  const insertBranch = sqlite.prepare(`
    INSERT INTO analysis_branches
      (id, session_id, name, parent_branch_id, forked_from_document_id,
       head_document_id, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)
  `);
  const updateDocument = sqlite.prepare(`
    UPDATE analysis_documents
    SET session_id = ?, branch_id = ?, parent_document_id = NULL
    WHERE id = ?
  `);
  const updateBranch = sqlite.prepare(
    'UPDATE analysis_branches SET head_document_id = ? WHERE id = ?',
  );
  const updateSession = sqlite.prepare(`
    UPDATE analysis_sessions
    SET active_branch_id = ?, active_document_id = ?
    WHERE id = ?
  `);

  for (const document of documents) {
    const sessionId = randomUUID();
    const branchId = randomUUID();
    insertSession.run(
      sessionId,
      document.projectId,
      deriveSessionTitle(document.goal),
      document.createdAt,
      document.updatedAt,
    );
    insertBranch.run(
      branchId,
      sessionId,
      '主分支',
      document.createdAt,
      document.updatedAt,
    );
    updateDocument.run(sessionId, branchId, document.id);
    updateBranch.run(document.id, branchId);
    updateSession.run(branchId, document.id, sessionId);
  }
}

function deriveSessionTitle(goal: string): string {
  const firstNonEmptyLine =
    goal
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? 'Untitled conversation';
  return Array.from(firstNonEmptyLine).slice(0, 60).join('');
}

function addSelectedText(sqlite: Database.Database): void {
  if (!hasColumn(sqlite, 'analysis_annotations', 'selected_text')) {
    sqlite.exec(
      `ALTER TABLE analysis_annotations
       ADD COLUMN selected_text TEXT NOT NULL DEFAULT ''`,
    );
  }
  sqlite.exec(`
    UPDATE analysis_annotations
    SET selected_text = anchor_exact_text
    WHERE selected_text = ''
  `);
}

function createIndexes(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_code_projects_root_path_hash
      ON code_projects(root_path_hash);
    CREATE INDEX IF NOT EXISTS idx_analysis_sessions_project_status_updated
      ON analysis_sessions(project_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_branches_session
      ON analysis_branches(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_documents_project
      ON analysis_documents(project_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_documents_session
      ON analysis_documents(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_documents_branch
      ON analysis_documents(branch_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_documents_parent
      ON analysis_documents(parent_document_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_tool_traces_document
      ON analysis_tool_traces(analysis_document_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_annotations_document
      ON analysis_annotations(analysis_document_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_discussion_messages_annotation
      ON analysis_discussion_messages(annotation_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_file_cleanup_queue_created
      ON analysis_file_cleanup_queue(created_at);
  `);
}

function createOwnershipAndCycleTriggers(sqlite: Database.Database): void {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS trg_analysis_sessions_validate_insert;
    DROP TRIGGER IF EXISTS trg_analysis_sessions_validate_update;
    DROP TRIGGER IF EXISTS trg_analysis_branches_validate_insert;
    DROP TRIGGER IF EXISTS trg_analysis_branches_validate_update;
    DROP TRIGGER IF EXISTS trg_analysis_documents_validate_insert;
    DROP TRIGGER IF EXISTS trg_analysis_documents_validate_update;

    CREATE TRIGGER trg_analysis_sessions_validate_insert
    BEFORE INSERT ON analysis_sessions
    BEGIN
      SELECT CASE
        WHEN NEW.active_branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_branches
            WHERE id = NEW.active_branch_id AND session_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis session active branch session mismatch')
      END;
      SELECT CASE
        WHEN NEW.active_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.active_document_id AND session_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis session active document session mismatch')
      END;
    END;

    CREATE TRIGGER trg_analysis_sessions_validate_update
    BEFORE UPDATE ON analysis_sessions
    BEGIN
      SELECT CASE
        WHEN NEW.active_branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_branches
            WHERE id = NEW.active_branch_id AND session_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis session active branch session mismatch')
      END;
      SELECT CASE
        WHEN NEW.active_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.active_document_id AND session_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis session active document session mismatch')
      END;
    END;

    CREATE TRIGGER trg_analysis_branches_validate_insert
    BEFORE INSERT ON analysis_branches
    BEGIN
      SELECT CASE
        WHEN NEW.parent_branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_branches
            WHERE id = NEW.parent_branch_id AND session_id = NEW.session_id
          )
        THEN RAISE(ABORT, 'analysis branch parent session mismatch')
      END;
      SELECT CASE
        WHEN NEW.forked_from_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.forked_from_document_id AND session_id = NEW.session_id
          )
        THEN RAISE(ABORT, 'analysis branch fork document session mismatch')
      END;
      SELECT CASE
        WHEN NEW.head_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.head_document_id AND branch_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis branch head branch mismatch')
      END;
    END;

    CREATE TRIGGER trg_analysis_branches_validate_update
    BEFORE UPDATE ON analysis_branches
    BEGIN
      SELECT CASE
        WHEN NEW.parent_branch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_branches
            WHERE id = NEW.parent_branch_id AND session_id = NEW.session_id
          )
        THEN RAISE(ABORT, 'analysis branch parent session mismatch')
      END;
      SELECT CASE
        WHEN NEW.forked_from_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.forked_from_document_id AND session_id = NEW.session_id
          )
        THEN RAISE(ABORT, 'analysis branch fork document session mismatch')
      END;
      SELECT CASE
        WHEN NEW.head_document_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM analysis_documents
            WHERE id = NEW.head_document_id AND branch_id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis branch head branch mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_documents
          WHERE branch_id = NEW.id AND session_id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis branch turn session mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_sessions
          WHERE active_branch_id = OLD.id AND id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis session active branch reverse mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_branches
          WHERE parent_branch_id = OLD.id AND session_id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis branch child branch session mismatch')
      END;
    END;

    CREATE TRIGGER trg_analysis_documents_validate_insert
    BEFORE INSERT ON analysis_documents
    BEGIN
      SELECT CASE
        WHEN NEW.branch_id IS NOT NULL
          AND (
            NEW.session_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM analysis_branches
              WHERE id = NEW.branch_id AND session_id = NEW.session_id
            )
          )
        THEN RAISE(ABORT, 'analysis turn branch session mismatch')
      END;
      SELECT CASE
        WHEN NEW.parent_document_id IS NOT NULL
          AND (
            NEW.session_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM analysis_documents
              WHERE id = NEW.parent_document_id AND session_id = NEW.session_id
            )
          )
        THEN RAISE(ABORT, 'analysis turn parent session mismatch')
      END;
      SELECT CASE
        WHEN NEW.parent_document_id = NEW.id
        THEN RAISE(ABORT, 'analysis turn parent cycle')
      END;
    END;

    CREATE TRIGGER trg_analysis_documents_validate_update
    BEFORE UPDATE ON analysis_documents
    BEGIN
      SELECT CASE
        WHEN NEW.branch_id IS NOT NULL
          AND (
            NEW.session_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM analysis_branches
              WHERE id = NEW.branch_id AND session_id = NEW.session_id
            )
          )
        THEN RAISE(ABORT, 'analysis turn branch session mismatch')
      END;
      SELECT CASE
        WHEN NEW.parent_document_id IS NOT NULL
          AND (
            NEW.session_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM analysis_documents
              WHERE id = NEW.parent_document_id AND session_id = NEW.session_id
            )
          )
        THEN RAISE(ABORT, 'analysis turn parent session mismatch')
      END;
      SELECT CASE
        WHEN NEW.parent_document_id = NEW.id
        THEN RAISE(ABORT, 'analysis turn parent cycle')
      END;
      SELECT CASE
        WHEN NEW.parent_document_id IS NOT NULL
          AND EXISTS (
            WITH RECURSIVE ancestors(id, parent_document_id) AS (
              SELECT id, parent_document_id
              FROM analysis_documents
              WHERE id = NEW.parent_document_id
              UNION ALL
              SELECT document.id, document.parent_document_id
              FROM analysis_documents AS document
              JOIN ancestors
                ON document.id = ancestors.parent_document_id
              WHERE ancestors.parent_document_id IS NOT NULL
            )
            SELECT 1 FROM ancestors WHERE id = NEW.id
          )
        THEN RAISE(ABORT, 'analysis turn parent cycle')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_sessions
          WHERE active_document_id = OLD.id AND id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis session active document reverse mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_branches
          WHERE head_document_id = OLD.id AND id IS NOT NEW.branch_id
        )
        THEN RAISE(ABORT, 'analysis branch head reverse mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_branches
          WHERE forked_from_document_id = OLD.id
            AND session_id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis branch fork document reverse mismatch')
      END;
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM analysis_documents
          WHERE parent_document_id = OLD.id AND session_id IS NOT NEW.session_id
        )
        THEN RAISE(ABORT, 'analysis turn child parent session mismatch')
      END;
    END;
  `);
}
