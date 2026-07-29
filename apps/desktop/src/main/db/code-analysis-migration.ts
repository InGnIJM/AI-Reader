import { createHash } from 'crypto';
import { parse, resolve } from 'path';
import type Database from 'better-sqlite3';

interface ProjectRow {
  id: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
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

export function migrateCodeAnalysisSchema(sqlite: Database.Database): void {
  makeProjectIdNullable(sqlite);
  mergeDuplicateProjects(sqlite);
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_code_projects_root_path_hash
      ON code_projects(root_path_hash);
    CREATE INDEX IF NOT EXISTS idx_analysis_documents_project
      ON analysis_documents(project_id);
  `);
}

function makeProjectIdNullable(sqlite: Database.Database): void {
  const column = sqlite
    .prepare(
      `SELECT "notnull" AS isNotNull
       FROM pragma_table_info('analysis_documents')
       WHERE name = 'project_id'`,
    )
    .get() as { isNotNull: number } | undefined;
  if (!column || column.isNotNull === 0) return;

  const foreignKeysEnabled = sqlite.pragma('foreign_keys', { simple: true }) === 1;
  if (foreignKeysEnabled) sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.exec(`
      BEGIN;
      CREATE TABLE analysis_documents_new (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES code_projects(id) ON DELETE CASCADE,
        goal TEXT NOT NULL,
        content_markdown TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        model_id TEXT,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO analysis_documents_new
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      SELECT id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at
      FROM analysis_documents;
      DROP TABLE analysis_documents;
      ALTER TABLE analysis_documents_new RENAME TO analysis_documents;
      COMMIT;
    `);
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    if (foreignKeysEnabled) sqlite.pragma('foreign_keys = ON');
  }
}

function mergeDuplicateProjects(sqlite: Database.Database): void {
  const projects = sqlite
    .prepare(
      `SELECT id, root_path AS rootPath, created_at AS createdAt, updated_at AS updatedAt
       FROM code_projects
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as ProjectRow[];

  const merge = sqlite.transaction(() => {
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
  });

  merge();
}
