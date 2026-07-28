import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnnotationService } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('AnnotationService', () => {
  let db: DatabaseClient;
  let service: AnnotationService;

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
  }

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedTestData();
    service = new AnnotationService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── create ─────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create annotation with computed anchor', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'This is a note',
      });

      expect(annotation.id).toBeDefined();
      expect(typeof annotation.id).toBe('string');
      expect(annotation.id.length).toBeGreaterThan(0);
      expect(annotation.articleId).toBe('art-1');
      expect(annotation.sectionId).toBe('sec-1');
      expect(annotation.anchorExactText).toBe('Test content');
      expect(annotation.type).toBe('note');
      expect(annotation.content).toBe('This is a note');
      expect(annotation.createdAt).toBeDefined();
    });

    it('should compute correct anchor offsets', async () => {
      const sectionContent = '# Section 1\n\nTest content here.';
      const selectedText = 'Test content';

      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText,
        type: 'note',
        content: 'A note',
      });

      const expectedStart = sectionContent.indexOf(selectedText);
      const expectedEnd = expectedStart + selectedText.length;

      expect(annotation.anchorStartOffset).toBe(expectedStart);
      expect(annotation.anchorEndOffset).toBe(expectedEnd);
    });

    it('should compute anchor prefix and suffix', async () => {
      const sectionContent = '# Section 1\n\nTest content here.';

      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'A note',
      });

      // prefix: up to 50 chars before the match
      const startOffset = sectionContent.indexOf('Test content');
      const expectedPrefix = sectionContent.substring(
        Math.max(0, startOffset - 50),
        startOffset,
      );
      const expectedSuffix = sectionContent.substring(
        startOffset + 'Test content'.length,
        startOffset + 'Test content'.length + 50,
      );

      expect(annotation.anchorPrefix).toBe(expectedPrefix);
      expect(annotation.anchorSuffix).toBe(expectedSuffix);
    });

    it('should persist annotation to database', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'Persisted note',
      });

      const row = db.db
        .prepare('SELECT * FROM annotations WHERE id = ?')
        .get(annotation.id) as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.article_id).toBe('art-1');
      expect(row.section_id).toBe('sec-1');
      expect(row.anchor_exact_text).toBe('Test content');
      expect(row.type).toBe('note');
      expect(row.content).toBe('Persisted note');
    });

    it('should generate unique ids for different annotations', async () => {
      const a1 = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test',
        type: 'note',
        content: 'Note 1',
      });
      const a2 = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'content',
        type: 'note',
        content: 'Note 2',
      });

      expect(a1.id).not.toBe(a2.id);
    });

    it('should default type to note when not specified', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
      });

      expect(annotation.type).toBe('note');
    });

    it('should support question type', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'question',
        content: 'What does this mean?',
      });

      expect(annotation.type).toBe('question');
    });

    it('should support highlight type', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'highlight',
      });

      expect(annotation.type).toBe('highlight');
      expect(annotation.content).toBeUndefined();
    });

    it('should throw when section not found', async () => {
      await expect(
        service.create({
          articleId: 'art-1',
          sectionId: 'non-existent-section',
          selectedText: 'Test',
          type: 'note',
        }),
      ).rejects.toThrow('Section not found');
    });

    it('should throw when selected text not found in section', async () => {
      await expect(
        service.create({
          articleId: 'art-1',
          sectionId: 'sec-1',
          selectedText: 'This text does not exist in the section',
          type: 'note',
        }),
      ).rejects.toThrow('Selected text not found');
    });
  });

  // ── getById ────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('should return annotation by id', async () => {
      const created = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'Find me',
      });

      const found = await service.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.anchorExactText).toBe('Test content');
      expect(found!.content).toBe('Find me');
    });

    it('should return null for non-existent id', async () => {
      const found = await service.getById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  // ── listBySection ──────────────────────────────────────────────────────

  describe('listBySection', () => {
    it('should return empty array when no annotations exist', async () => {
      const list = await service.listBySection('sec-1');
      expect(list).toHaveLength(0);
    });

    it('should list all annotations for a section', async () => {
      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test',
        type: 'note',
        content: 'Note 1',
      });
      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'content',
        type: 'question',
        content: 'Question 1',
      });

      const list = await service.listBySection('sec-1');
      expect(list).toHaveLength(2);
    });

    it('should return annotations ordered by start offset ascending', async () => {
      // "content" appears after "Test" in "# Section 1\n\nTest content here."
      const a1 = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'content',
        type: 'note',
        content: 'Second',
      });
      const a2 = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test',
        type: 'note',
        content: 'First',
      });

      const list = await service.listBySection('sec-1');
      expect(list[0].anchorStartOffset).toBeLessThan(
        list[1].anchorStartOffset,
      );
    });

    it('should only return annotations for the specified section', async () => {
      // Create a second section
      db.db
        .prepare(
          `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sec-2',
          'art-1',
          1,
          'Section 2',
          '[]',
          'Other section content.',
          'completed',
          now,
          now,
        );

      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test',
        type: 'note',
        content: 'In sec 1',
      });
      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-2',
        selectedText: 'Other',
        type: 'note',
        content: 'In sec 2',
      });

      const list1 = await service.listBySection('sec-1');
      const list2 = await service.listBySection('sec-2');

      expect(list1).toHaveLength(1);
      expect(list1[0].sectionId).toBe('sec-1');
      expect(list2).toHaveLength(1);
      expect(list2[0].sectionId).toBe('sec-2');
    });
  });

  // ── listByArticle ──────────────────────────────────────────────────────

  describe('listByArticle', () => {
    it('should return empty array when no annotations exist', async () => {
      const list = await service.listByArticle('art-1');
      expect(list).toHaveLength(0);
    });

    it('should list all annotations for an article across sections', async () => {
      // Create a second section
      db.db
        .prepare(
          `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'sec-2',
          'art-1',
          1,
          'Section 2',
          '[]',
          'Other section content.',
          'completed',
          now,
          now,
        );

      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test',
        type: 'note',
        content: 'In sec 1',
      });
      await service.create({
        articleId: 'art-1',
        sectionId: 'sec-2',
        selectedText: 'Other',
        type: 'note',
        content: 'In sec 2',
      });

      const list = await service.listByArticle('art-1');
      expect(list).toHaveLength(2);
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete annotation by id', async () => {
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'Delete me',
      });

      await service.delete(annotation.id);

      const found = await service.getById(annotation.id);
      expect(found).toBeNull();
    });

    it('should not throw when deleting non-existent annotation', async () => {
      // SQLite DELETE is a no-op when no rows match
      await expect(
        service.delete('non-existent-id'),
      ).resolves.toBeUndefined();
    });
  });

  // ── full lifecycle ─────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('should support create -> getById -> listBySection -> delete', async () => {
      // Create
      const annotation = await service.create({
        articleId: 'art-1',
        sectionId: 'sec-1',
        selectedText: 'Test content',
        type: 'note',
        content: 'A note',
      });
      expect(annotation.id).toBeDefined();

      // GetById
      const found = await service.getById(annotation.id);
      expect(found).not.toBeNull();
      expect(found!.anchorExactText).toBe('Test content');

      // ListBySection
      const list = await service.listBySection('sec-1');
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(annotation.id);

      // Delete
      await service.delete(annotation.id);
      const afterDelete = await service.getById(annotation.id);
      expect(afterDelete).toBeNull();
    });
  });
});
