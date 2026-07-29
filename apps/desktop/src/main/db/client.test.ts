import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type DatabaseClient } from './client';

describe('SQLite Client', () => {
  let client: DatabaseClient;

  beforeEach(() => {
    client = createDatabase(':memory:');
  });

  afterEach(() => {
    client.close();
  });

  it('should create database in memory', () => {
    expect(client).toBeDefined();
    expect(client.db).toBeDefined();
  });

  it('should create the complete transitional table inventory', () => {
    const tables = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toEqual([
      'analysis_annotations',
      'analysis_branches',
      'analysis_discussion_messages',
      'analysis_documents',
      'analysis_file_cleanup_queue',
      'analysis_sessions',
      'analysis_tool_traces',
      'annotations',
      'app_settings',
      'chapters',
      'code_projects',
      'discussion_messages',
      'documents',
      'generated_articles',
      'generated_sections',
      'generation_jobs',
      'llm_usage_records',
      'workspaces',
    ]);
  });

  it('should create the complete transitional index inventory', () => {
    const indexes = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name).sort();

    expect(indexNames).toEqual([
      'idx_analysis_annotations_document',
      'idx_analysis_branches_session',
      'idx_analysis_discussion_messages_annotation',
      'idx_analysis_documents_branch',
      'idx_analysis_documents_parent',
      'idx_analysis_documents_session',
      'idx_analysis_file_cleanup_queue_created',
      'idx_analysis_sessions_project_status_updated',
      'idx_analysis_tool_traces_document',
      'idx_annotations_article',
      'idx_annotations_section',
      'idx_chapters_document',
      'idx_discussion_messages_annotation',
      'idx_documents_workspace',
      'idx_generated_articles_source',
      'idx_generated_sections_article',
      'idx_generation_jobs_document',
    ]);
    expect(
      client.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = 'ux_code_projects_root_path_hash'",
        )
        .get(),
    ).toEqual({ name: 'ux_code_projects_root_path_hash' });
  });

  it('should enable WAL mode (or memory for :memory: db)', () => {
    const result = client.db.pragma('journal_mode', { simple: true }) as string;
    // In-memory databases cannot use WAL mode, they default to 'memory'
    expect(['wal', 'memory']).toContain(result);
  });

  it('should enable foreign keys', () => {
    const result = client.db.pragma('foreign_keys', { simple: true }) as number;
    expect(result).toBe(1);
  });

  describe('CRUD operations', () => {
    it('should insert and query workspace', () => {
      const now = new Date().toISOString();
      client.db
        .prepare(
          'INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('ws-1', 'Test Workspace', 'A test workspace', now, now);

      const row = client.db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get('ws-1') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.name).toBe('Test Workspace');
      expect(row.description).toBe('A test workspace');
      expect(row.created_at).toBe(now);
    });

    it('should cascade delete from workspace to documents', () => {
      const now = new Date().toISOString();

      // Insert workspace
      client.db
        .prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('ws-1', 'Test', now, now);

      // Insert document
      client.db
        .prepare(
          `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, title, raw_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('doc-1', 'ws-1', 'test.md', 'markdown', 'abc123', 'Test', 'content', 'ready', now, now);

      // Verify document exists
      const doc = client.db.prepare('SELECT * FROM documents WHERE id = ?').get('doc-1');
      expect(doc).toBeDefined();

      // Delete workspace - should cascade to documents
      client.db.prepare('DELETE FROM workspaces WHERE id = ?').run('ws-1');

      // Document should be gone
      const deletedDoc = client.db.prepare('SELECT * FROM documents WHERE id = ?').get('doc-1');
      expect(deletedDoc).toBeUndefined();
    });

    it('should insert and query app_settings', () => {
      const now = new Date().toISOString();
      client.db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run('theme', 'dark', now);

      const row = client.db
        .prepare('SELECT * FROM app_settings WHERE key = ?')
        .get('theme') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.value).toBe('dark');
    });

    it('should insert and query llm_usage_records', () => {
      const now = new Date().toISOString();
      client.db
        .prepare(
          'INSERT INTO llm_usage_records (id, request_type, model_id, input_tokens, output_tokens, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run('usage-1', 'outline', 'gpt-4o-mini', 100, 50, 0.001, now);

      const row = client.db
        .prepare('SELECT * FROM llm_usage_records WHERE id = ?')
        .get('usage-1') as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.request_type).toBe('outline');
      expect(row.input_tokens).toBe(100);
      expect(row.cost).toBeCloseTo(0.001);
    });

    it('should handle full annotation + discussion flow', () => {
      const now = new Date().toISOString();

      // Setup prerequisite data
      client.db
        .prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('ws-1', 'Test', now, now);
      client.db
        .prepare(
          `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, title, raw_text, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('doc-1', 'ws-1', 'test.md', 'markdown', 'hash', 'Test', 'content', 'ready', now, now);
      client.db
        .prepare(
          `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run('art-1', 'doc-1', 'Test Article', 'completed', now, now);
      client.db
        .prepare(
          `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('sec-1', 'art-1', 0, 'Section 1', '[]', 'Test content.', 'completed', now, now);

      // Create annotation
      client.db
        .prepare(
          `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('ann-1', 'art-1', 'sec-1', 0, 4, 'Test', '', ' content', 'note', 'A note', now, now);

      // Add discussion messages
      client.db
        .prepare(
          `INSERT INTO discussion_messages (id, annotation_id, role, content, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run('msg-1', 'ann-1', 'user', 'What is this?', now);
      client.db
        .prepare(
          `INSERT INTO discussion_messages (id, annotation_id, role, content, model_id, token_usage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('msg-2', 'ann-1', 'assistant', 'This is a test.', 'gpt-4o', '{"input":10,"output":5}', now);

      // Verify
      const messages = client.db
        .prepare('SELECT * FROM discussion_messages WHERE annotation_id = ? ORDER BY created_at')
        .all('ann-1') as Record<string, unknown>[];

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].model_id).toBe('gpt-4o');
    });
  });
});
