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
    db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'project-1', 'Explain startup', '# Startup\n\nUses IPC.', 'completed', 'mock', 1, ?, ?)
    `,
      )
      .run(now, now);
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

  it('exports Markdown with comments and replies', async () => {
    const service = new AnalysisExportService(db);
    const markdown = await service.exportMarkdown('doc-1');

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

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      const imported = await targetService.importJson(exported);

      expect(imported.contentMarkdown).toContain('# Startup');
      const restoredMessages = targetDb.db
        .prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages')
        .get();
      expect(restoredMessages).toEqual({ count: 1 });
    } finally {
      targetDb.close();
    }
  });
});
