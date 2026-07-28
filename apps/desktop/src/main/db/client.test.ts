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

  it('should create all 10 MVP tables', () => {
    const tables = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain('workspaces');
    expect(tableNames).toContain('documents');
    expect(tableNames).toContain('chapters');
    expect(tableNames).toContain('generated_articles');
    expect(tableNames).toContain('generated_sections');
    expect(tableNames).toContain('generation_jobs');
    expect(tableNames).toContain('annotations');
    expect(tableNames).toContain('discussion_messages');
    expect(tableNames).toContain('llm_usage_records');
    expect(tableNames).toContain('app_settings');
  });

  it('should create indexes', () => {
    const indexes = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_documents_workspace');
    expect(indexNames).toContain('idx_chapters_document');
    expect(indexNames).toContain('idx_annotations_article');
    expect(indexNames).toContain('idx_annotations_section');
    expect(indexNames).toContain('idx_discussion_messages_annotation');
    expect(indexNames).toContain('idx_generated_sections_article');
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
