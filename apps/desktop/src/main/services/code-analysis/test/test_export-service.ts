import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisExportService, type AireaderCodeAnalysisExport } from '../export-service';

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

  it('exportDocument returns markdown artifact with default file name', async () => {
    const service = new AnalysisExportService(db);
    const artifact = await service.exportDocument('doc-1', 'markdown');

    expect(artifact.format).toBe('markdown');
    expect(artifact.defaultFileName).toBe('Startup Analysis.md');
    expect(artifact.content).toContain('# Startup');
  });

  it('exportDocument returns JSON artifact as pretty-printed string', async () => {
    const service = new AnalysisExportService(db);
    const artifact = await service.exportDocument('doc-1', 'json');

    expect(artifact.format).toBe('json');
    expect(artifact.defaultFileName).toBe('Startup Analysis.json');
    const parsed = JSON.parse(artifact.content) as AireaderCodeAnalysisExport;
    expect(parsed.type).toBe('code-analysis-document');
    expect(parsed.sessionTitle).toBe('Startup Analysis');
  });

  it('exports every document and branch in a session JSON artifact', async () => {
    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO analysis_documents
          (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('doc-2', 'session-1', 'branch-1', 'doc-1', 'Explain shutdown', '# Shutdown', 'completed', NULL, 0, ?, ?)`,
      )
      .run(now, now);
    db.db.prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?').run('doc-2', 'branch-1');

    const artifact = await new AnalysisExportService(db).exportSession('session-1', 'json');
    const parsed = JSON.parse(artifact.content) as {
      type: string;
      session: { id: string; title: string };
      branches: Array<{ id: string }>;
      documents: Array<{ id: string }>;
    };

    expect(artifact.defaultFileName).toBe('Startup Analysis.session.json');
    expect(parsed.type).toBe('code-analysis-session');
    expect(parsed.session).toMatchObject({ id: 'session-1', title: 'Startup Analysis' });
    expect(parsed.branches).toEqual([expect.objectContaining({ id: 'branch-1' })]);
    expect(parsed.documents.map((document) => document.id)).toEqual(['doc-1', 'doc-2']);
  });

  it('exports every document in a session Markdown artifact', async () => {
    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO analysis_documents
          (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('doc-2', 'session-1', 'branch-1', 'doc-1', 'Explain shutdown', '# Shutdown', 'completed', NULL, 0, ?, ?)`,
      )
      .run(now, now);

    const artifact = await new AnalysisExportService(db).exportSession('session-1', 'markdown');

    expect(artifact.defaultFileName).toBe('Startup Analysis.session.md');
    expect(artifact.content).toContain('# Startup Analysis');
    expect(artifact.content).toContain('## Explain startup');
    expect(artifact.content).toContain('## Explain shutdown');
    expect(artifact.content).toContain('# Shutdown');
  });

  it('rejects unsupported session export formats', async () => {
    await expect(
      new AnalysisExportService(db).exportSession('session-1', 'html' as never),
    ).rejects.toThrow('Unsupported export format: html');
  });

  it('exportDocument sanitizes illegal file name characters', async () => {
    db.db.prepare("UPDATE analysis_sessions SET title = 'A/B:C*?' WHERE id = 'session-1'").run();
    const service = new AnalysisExportService(db);
    const artifact = await service.exportDocument('doc-1', 'markdown');

    expect(artifact.defaultFileName).toBe('A_B_C__.md');
  });

  it('exportDocument throws for unsupported format', async () => {
    const service = new AnalysisExportService(db);
    await expect(service.exportDocument('doc-1', 'html' as never)).rejects.toThrow(
      'Unsupported export format: html',
    );
  });

  it('importDocument delegates to importJson for code-analysis-document type', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      const imported = await targetService.importDocument(exported);

      expect(imported.contentMarkdown).toContain('# Startup');
      const session = targetDb.db
        .prepare('SELECT title FROM analysis_sessions')
        .get() as { title: string };
      expect(session.title).toBe('Startup Analysis');
    } finally {
      targetDb.close();
    }
  });

  it('importDocument throws for unsupported type', async () => {
    const service = new AnalysisExportService(db);
    await expect(service.importDocument({ type: 'unknown-format' })).rejects.toThrow(
      'Unsupported import format: unknown-format',
    );
  });

  it('importDocument throws for non-object payload', async () => {
    const service = new AnalysisExportService(db);
    await expect(service.importDocument('plain text')).rejects.toThrow(
      'Invalid import payload: expected an object',
    );
  });

  it('importJson rejects payloads with an unsupported schema or type', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    await expect(
      service.importJson({ ...exported, schemaVersion: 2 } as never),
    ).rejects.toThrow('Unsupported code analysis export payload');
    await expect(
      service.importJson({ ...exported, type: 'other-format' } as never),
    ).rejects.toThrow('Unsupported code analysis export payload');
  });

  it('importJson restores tool traces', async () => {
    db.db
      .prepare(
        `
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES ('trace-1', 'doc-1', 0, 'listFiles', '{"path":"src"}', 'found 2 files', ?)
    `,
      )
      .run(new Date().toISOString());

    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');
    expect(exported.toolTrace).toHaveLength(1);

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      await targetService.importJson(exported);

      const traces = targetDb.db
        .prepare(
          'SELECT step_index AS stepIndex, tool_name AS toolName, result_summary AS resultSummary FROM analysis_tool_traces',
        )
        .all();
      expect(traces).toEqual([
        { stepIndex: 0, toolName: 'listFiles', resultSummary: 'found 2 files' },
      ]);
    } finally {
      targetDb.close();
    }
  });

  it('export throws when the document does not exist', async () => {
    const service = new AnalysisExportService(db);
    await expect(service.exportMarkdown('missing-doc')).rejects.toThrow(
      'Analysis document not found: missing-doc',
    );
  });

  it('importJson skips discussion messages that reference unknown annotations', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');
    const withOrphanMessage = {
      ...exported,
      discussionMessages: [
        ...exported.discussionMessages,
        {
          annotationId: 'ann-missing',
          role: 'assistant',
          content: 'orphan reply',
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      ],
    };

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      await targetService.importJson(withOrphanMessage as never);

      const messages = targetDb.db
        .prepare('SELECT COUNT(*) AS c FROM analysis_discussion_messages')
        .get() as { c: number };
      expect(messages.c).toBe(1); // 只有 ann-1 的消息被导入，孤儿消息被跳过
    } finally {
      targetDb.close();
    }
  });

  it('importJson fills defaults when optional fields are absent', async () => {
    const minimal = {
      schemaVersion: 1,
      type: 'code-analysis-document',
      sessionTitle: undefined,
      sourceDirectoryName: 'No Project',
      sourceDirectoryPathHash: '',
      analysisGoal: 'Minimal',
      analysisMarkdown: '# Minimal',
      toolTrace: [],
      referencedFiles: [],
      annotations: [
        {
          id: 'ann-a',
          anchorStartOffset: 0,
          anchorEndOffset: 1,
          anchorExactText: 'M',
          anchorPrefix: '',
          anchorSuffix: '',
          question: 'Q',
          status: 'pending',
          createdAt: '2026-07-31T00:00:00.000Z',
          updatedAt: '2026-07-31T00:00:00.000Z',
        },
      ],
      discussionMessages: [
        {
          annotationId: 'ann-a',
          role: 'assistant',
          content: 'Reply',
          modelId: undefined,
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      ],
      modelInfo: {},
      createdAt: '2026-07-31T00:00:00.000Z',
      exportedAt: '2026-07-31T00:00:00.000Z',
    };

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      const imported = await targetService.importJson(minimal as never);

      expect(imported.contentMarkdown).toContain('# Minimal');
      const session = targetDb.db
        .prepare('SELECT title FROM analysis_sessions')
        .get() as { title: string };
      expect(session.title).toBe('Imported Session'); // ?? 默认值
      const doc = targetDb.db
        .prepare('SELECT model_id AS modelId FROM analysis_documents WHERE id = ?')
        .get(imported.id) as { modelId: string | null };
      expect(doc.modelId).toBeNull();
      const msg = targetDb.db
        .prepare('SELECT model_id AS modelId FROM analysis_discussion_messages')
        .get() as { modelId: string | null };
      expect(msg.modelId).toBeNull();
    } finally {
      targetDb.close();
    }
  });

  it('exportJson falls back to No Project metadata for local sessions', async () => {
    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO analysis_sessions (id, project_id, title, status, active_branch_id, active_document_id, created_at, updated_at)
         VALUES ('session-local', NULL, 'Local', 'active', NULL, NULL, ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
         VALUES ('branch-local', 'session-local', '主分支', NULL, NULL, NULL, ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_documents (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('doc-local', 'session-local', 'branch-local', 'Local', '# Local', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);
    db.db.prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?').run('doc-local', 'branch-local');
    db.db
      .prepare('UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ? WHERE id = ?')
      .run('branch-local', 'doc-local', 'session-local');

    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-local');

    expect(exported.sourceDirectoryName).toBe('No Project');
    expect(exported.sourceDirectoryPathHash).toBe('');
  });

  it('importDocument reports unknown when the payload has no type field', async () => {
    const service = new AnalysisExportService(db);
    await expect(service.importDocument({})).rejects.toThrow('Unsupported import format: unknown');
  });

  it('exportDocument uses a generic file name when the session title is only whitespace', async () => {
    db.db.prepare("UPDATE analysis_sessions SET title = '   ' WHERE id = 'session-1'").run();
    const service = new AnalysisExportService(db);
    const artifact = await service.exportDocument('doc-1', 'markdown');

    expect(artifact.defaultFileName).toBe('export.md');
  });

  it('importJson rolls back the transaction when a step fails', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      // content_markdown 显式传入 undefined 会违反 NOT NULL 约束，触发回滚
      await expect(
        targetService.importJson({ ...exported, analysisMarkdown: undefined } as never),
      ).rejects.toThrow();

      const sessions = targetDb.db
        .prepare('SELECT COUNT(*) AS c FROM analysis_sessions')
        .get() as { c: number };
      const branches = targetDb.db
        .prepare('SELECT COUNT(*) AS c FROM analysis_branches')
        .get() as { c: number };
      const documents = targetDb.db
        .prepare('SELECT COUNT(*) AS c FROM analysis_documents')
        .get() as { c: number };
      expect(sessions.c).toBe(0);
      expect(branches.c).toBe(0);
      expect(documents.c).toBe(0);
    } finally {
      targetDb.close();
    }
  });
});
