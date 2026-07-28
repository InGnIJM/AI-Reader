import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DiscussionService } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('DiscussionService', () => {
  let db: DatabaseClient;
  let service: DiscussionService;

  const now = new Date().toISOString();

  function seedTestData() {
    db.db
      .prepare(
        `INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run('ws-1', 'Test', now, now);

    db.db
      .prepare(
        `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, title, raw_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'doc-1',
        'ws-1',
        'test.md',
        'markdown',
        'hash',
        'Test',
        'content',
        'ready',
        now,
        now,
      );

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-1', 'doc-1', 'Test Article', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'sec-1',
        'art-1',
        0,
        'Section 1',
        '[]',
        '# Section 1\n\nTest content here.',
        'completed',
        now,
        now,
      );

    db.db
      .prepare(
        `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'ann-1',
        'art-1',
        'sec-1',
        0,
        4,
        'Test',
        '',
        ' content',
        'note',
        'Test note',
        now,
        now,
      );

    db.db
      .prepare(
        `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'ann-2',
        'art-1',
        'sec-1',
        5,
        12,
        'content',
        'Test ',
        ' here.',
        'question',
        'Question annotation',
        now,
        now,
      );
  }

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedTestData();
    service = new DiscussionService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── addMessage ──────────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('should add user message', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'What is this?',
      });

      expect(msg.id).toBeDefined();
      expect(typeof msg.id).toBe('string');
      expect(msg.id.length).toBeGreaterThan(0);
      expect(msg.annotationId).toBe('ann-1');
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('What is this?');
      expect(msg.createdAt).toBeDefined();
    });

    it('should add assistant message', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'This is a test content section.',
      });

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('This is a test content section.');
    });

    it('should persist message to database', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Persisted question',
      });

      const row = db.db
        .prepare('SELECT * FROM discussion_messages WHERE id = ?')
        .get(msg.id) as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.annotation_id).toBe('ann-1');
      expect(row.role).toBe('user');
      expect(row.content).toBe('Persisted question');
    });

    it('should store modelId when provided', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'AI reply',
        modelId: 'gpt-4o-mini',
      });

      expect(msg.modelId).toBe('gpt-4o-mini');

      const found = await service.getById(msg.id);
      expect(found?.modelId).toBe('gpt-4o-mini');
    });

    it('should store tokenUsage as JSON string when provided', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'AI reply',
        tokenUsage: { input: 100, output: 50 },
      });

      expect(msg.tokenUsage).toBe('{"input":100,"output":50}');

      const found = await service.getById(msg.id);
      expect(found?.tokenUsage).toBe('{"input":100,"output":50}');
    });

    it('should leave modelId undefined when not provided', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question',
      });

      expect(msg.modelId).toBeUndefined();
    });

    it('should leave tokenUsage undefined when not provided', async () => {
      const msg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question',
      });

      expect(msg.tokenUsage).toBeUndefined();
    });

    it('should generate unique ids for different messages', async () => {
      const m1 = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question 1',
      });
      const m2 = await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'Answer 1',
      });

      expect(m1.id).not.toBe(m2.id);
    });

    it('should allow messages on different annotations', async () => {
      const m1 = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question on ann-1',
      });
      const m2 = await service.addMessage({
        annotationId: 'ann-2',
        role: 'user',
        content: 'Question on ann-2',
      });

      expect(m1.annotationId).toBe('ann-1');
      expect(m2.annotationId).toBe('ann-2');
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('should return message by id', async () => {
      const created = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Find me',
      });

      const found = await service.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.content).toBe('Find me');
      expect(found!.role).toBe('user');
    });

    it('should return null for non-existent id', async () => {
      const found = await service.getById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  // ── listByAnnotation ────────────────────────────────────────────────────

  describe('listByAnnotation', () => {
    it('should return empty array when no messages exist', async () => {
      const list = await service.listByAnnotation('ann-1');
      expect(list).toHaveLength(0);
    });

    it('should list all messages for an annotation', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question',
      });
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'Answer',
      });

      const messages = await service.listByAnnotation('ann-1');
      expect(messages).toHaveLength(2);
    });

    it('should return messages in chronological order', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'First',
      });
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'Second',
      });
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Third',
      });

      const messages = await service.listByAnnotation('ann-1');
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('should preserve role ordering (user then assistant)', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Question',
      });
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'Answer',
      });

      const messages = await service.listByAnnotation('ann-1');
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
    });

    it('should only return messages for the specified annotation', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'On ann-1',
      });
      await service.addMessage({
        annotationId: 'ann-2',
        role: 'user',
        content: 'On ann-2',
      });

      const list1 = await service.listByAnnotation('ann-1');
      const list2 = await service.listByAnnotation('ann-2');

      expect(list1).toHaveLength(1);
      expect(list1[0].annotationId).toBe('ann-1');
      expect(list2).toHaveLength(1);
      expect(list2[0].annotationId).toBe('ann-2');
    });
  });

  // ── deleteByAnnotation ──────────────────────────────────────────────────

  describe('deleteByAnnotation', () => {
    it('should delete all messages for an annotation', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'Q1',
      });
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'A1',
      });

      await service.deleteByAnnotation('ann-1');

      const list = await service.listByAnnotation('ann-1');
      expect(list).toHaveLength(0);
    });

    it('should not delete messages for other annotations', async () => {
      await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'On ann-1',
      });
      await service.addMessage({
        annotationId: 'ann-2',
        role: 'user',
        content: 'On ann-2',
      });

      await service.deleteByAnnotation('ann-1');

      const list2 = await service.listByAnnotation('ann-2');
      expect(list2).toHaveLength(1);
      expect(list2[0].content).toBe('On ann-2');
    });

    it('should not throw when deleting non-existent annotation', async () => {
      await expect(
        service.deleteByAnnotation('non-existent'),
      ).resolves.toBeUndefined();
    });
  });

  // ── full lifecycle ──────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('should support addMessage -> listByAnnotation -> getById -> deleteByAnnotation', async () => {
      // Add messages
      const userMsg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: 'What does this mean?',
      });
      expect(userMsg.id).toBeDefined();

      const aiMsg = await service.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: 'It means...',
        modelId: 'gpt-4o-mini',
        tokenUsage: { input: 50, output: 20 },
      });
      expect(aiMsg.id).toBeDefined();

      // List
      const messages = await service.listByAnnotation('ann-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');

      // GetById
      const found = await service.getById(userMsg.id);
      expect(found).not.toBeNull();
      expect(found!.content).toBe('What does this mean?');

      // Delete
      await service.deleteByAnnotation('ann-1');
      const afterDelete = await service.listByAnnotation('ann-1');
      expect(afterDelete).toHaveLength(0);
    });
  });
});
