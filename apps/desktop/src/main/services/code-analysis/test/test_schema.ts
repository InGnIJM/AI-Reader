import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';

describe('code-analysis database schema', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates code analysis tables and cascades document children', () => {
    const now = new Date().toISOString();

    db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('project-1', 'AI-Reader', 'E:/code/AI-Reader', 'hash-1', now, now);

    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('doc-1', 'project-1', 'Analyze architecture', '# Result', 'completed', 'gpt-test', 2, now, now);

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
