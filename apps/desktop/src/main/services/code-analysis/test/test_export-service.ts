import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisExportService } from '../export-service';

describe('AnalysisExportService', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const now = new Date().toISOString();
    db.db
      .prepare(
        `
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES ('project-1', 'Fixture', '/secret/path', 'hash-1', ?, ?)
    `,
      )
      .run(now, now);
    // Create session (active_branch_id and active_document_id set after branch/document exist)
    db.db
      .prepare(
        `
      INSERT INTO analysis_sessions
        (id, project_id, title, status, active_branch_id, active_document_id, created_at, updated_at)
      VALUES ('session-1', 'project-1', 'Startup Analysis', 'active', NULL, NULL, ?, ?)
    `,
      )
      .run(now, now);
    // Create branch (head_document_id set after document exists)
    db.db
      .prepare(
        `
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
      VALUES ('branch-1', 'session-1', '主分支', NULL, NULL, NULL, ?, ?)
    `,
      )
      .run(now, now);
    // Create document linked to session and branch
    db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'session-1', 'branch-1', 'Explain startup', '# Startup\n\nUses IPC.', 'completed', 'mock', 1, ?, ?)
    `,
      )
      .run(now, now);
    // Update branch head and session active pointers
    db.db
      .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
      .run('doc-1', 'branch-1');
    db.db
      .prepare(
        'UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ? WHERE id = ?',
      )
      .run('branch-1', 'doc-1', 'session-1');
    db.db
      .prepare(
        `
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES ('ann-1', 'doc-1', 2, 9, 'Startup', '# ', '', 'What starts?', 'answered', ?, ?)
    `,
      )
      .run(now, now);
    db.db
      .prepare(
        `
      INSERT INTO analysis_discussion_messages (id, annotation_id, role, content, model_id, created_at)
      VALUES ('msg-1', 'ann-1', 'assistant', 'The app starts in Electron main.', 'mock', ?)
    `,
      )
      .run(now);
  });

  afterEach(() => {
    db.close();
  });

  it('exports Markdown with session title, comments and replies', async () => {
    const service = new AnalysisExportService(db);
    const markdown = await service.exportMarkdown('doc-1');

    expect(markdown).toContain('Startup Analysis');
    expect(markdown).toContain('# Startup');
    expect(markdown).toContain('## Comments');
    expect(markdown).toContain('What starts?');
    expect(markdown).toContain('The app starts in Electron main.');
  });

  it('exports JSON without absolute source path and reimports state', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    expect(exported.type).toBe('code-analysis-document');
    expect(JSON.stringify(exported)).not.toContain('/secret/path');
    expect(exported.sessionId).toBe('session-1');
    expect(exported.sessionTitle).toBe('Startup Analysis');

    const targetDb = createDatabase(':memory:');
    const localDocumentsPath = mkdtempSync(join(tmpdir(), 'ai-reader-import-'));
    try {
      const targetService = new AnalysisExportService(targetDb, localDocumentsPath);
      const imported = await targetService.importJson(exported);

      expect(imported.contentMarkdown).toContain('# Startup');
      expect(
        readFileSync(join(localDocumentsPath, imported.id, 'document.md'), 'utf8'),
      ).toContain('# Startup');
      const restoredMessages = targetDb.db
        .prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages')
        .get();
      expect(restoredMessages).toEqual({ count: 1 });
    } finally {
      targetDb.close();
      rmSync(localDocumentsPath, { recursive: true, force: true });
    }
  });

  it('exportJson fetches project metadata via session join', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    // Project info comes through session -> project join, not direct document.project_id
    expect(exported.sourceDirectoryName).toBe('Fixture');
    expect(exported.sourceDirectoryPathHash).toBe('hash-1');
    expect(exported.sessionId).toBe('session-1');
    expect(exported.sessionTitle).toBe('Startup Analysis');
  });

  it('exportJson only exports annotations for the requested turn', async () => {
    const now = new Date().toISOString();
    // Create a second turn in the same session
    db.db
      .prepare(
        `
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
      VALUES ('branch-2', 'session-1', 'Branch 2', 'branch-1', 'doc-1', NULL, ?, ?)
    `,
      )
      .run(now, now);
    db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-2', 'session-1', 'branch-2', 'doc-1', 'Deep dive', '# Deep Dive', 'completed', 'mock', 0, ?, ?)
    `,
      )
      .run(now, now);
    db.db
      .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
      .run('doc-2', 'branch-2');
    db.db
      .prepare(
        `
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES ('ann-2', 'doc-2', 0, 4, 'Deep', '', '', 'What is deep?', 'pending', ?, ?)
    `,
      )
      .run(now, now);

    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    // Only doc-1's annotations should be exported
    expect(exported.annotations).toHaveLength(1);
    expect(exported.annotations[0].id).toBe('ann-1');
    expect(exported.discussionMessages).toHaveLength(1);
    expect(exported.discussionMessages[0].annotationId).toBe('ann-1');
  });

  it('importJson creates session + branch + turn in a transaction', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      const imported = await targetService.importJson(exported);

      // Session should be created
      const session = targetDb.db
        .prepare('SELECT id, title, active_branch_id, active_document_id FROM analysis_sessions')
        .get() as { id: string; title: string; active_branch_id: string | null; active_document_id: string | null } | undefined;
      expect(session).toBeDefined();
      expect(session!.title).toBe('Startup Analysis');
      expect(session!.active_branch_id).toBeDefined();
      expect(session!.active_document_id).toBe(imported.id);

      // Branch should be created
      const branch = targetDb.db
        .prepare('SELECT id, session_id, name, head_document_id FROM analysis_branches')
        .get() as { id: string; session_id: string; name: string; head_document_id: string | null } | undefined;
      expect(branch).toBeDefined();
      expect(branch!.session_id).toBe(session!.id);
      expect(branch!.head_document_id).toBe(imported.id);

      // Document should be linked to session and branch
      const doc = targetDb.db
        .prepare('SELECT session_id, branch_id FROM analysis_documents WHERE id = ?')
        .get(imported.id) as { session_id: string; branch_id: string } | undefined;
      expect(doc).toBeDefined();
      expect(doc!.session_id).toBe(session!.id);
      expect(doc!.branch_id).toBe(branch!.id);
    } finally {
      targetDb.close();
    }
  });

  it('exportMarkdown includes session title', async () => {
    const service = new AnalysisExportService(db);
    const markdown = await service.exportMarkdown('doc-1');

    // Session title appears in the markdown output
    expect(markdown).toContain('Startup Analysis');
  });
});
