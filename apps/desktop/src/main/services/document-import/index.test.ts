import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentImportService } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('DocumentImportService', () => {
  let db: DatabaseClient;
  let service: DocumentImportService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    // Create a workspace for foreign key constraint
    const now = new Date().toISOString();
    db.db
      .prepare(
        'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      )
      .run('ws-1', 'Test Workspace', now, now);
    service = new DocumentImportService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('importFromContent', () => {
    it('should import markdown content and return document with chapters', async () => {
      const content = `# Chapter One\n\nContent one.\n\n# Chapter Two\n\nContent two.`;
      const result = await service.importFromContent('ws-1', 'test.md', content);

      expect(result.document.id).toBeDefined();
      expect(typeof result.document.id).toBe('string');
      expect(result.document.fileName).toBe('test.md');
      expect(result.document.fileType).toBe('markdown');
      expect(result.document.title).toBe('test');
      expect(result.document.status).toBe('ready');
      expect(result.chapters).toHaveLength(2);
      expect(result.chapters[0].title).toBe('Chapter One');
      expect(result.chapters[1].title).toBe('Chapter Two');
    });

    it('should import txt content as single chapter', async () => {
      const content = 'Paragraph one.\n\nParagraph two.';
      const result = await service.importFromContent('ws-1', 'notes.txt', content);

      expect(result.document.fileType).toBe('txt');
      expect(result.document.title).toBe('notes');
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe('notes');
    });

    it('should calculate SHA256 hash of content', async () => {
      const content = 'test content';
      const result = await service.importFromContent('ws-1', 'test.txt', content);

      expect(result.document.fileHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce identical hash for identical content', async () => {
      const content = 'same content';
      const r1 = await service.importFromContent('ws-1', 'a.txt', content);
      const r2 = await service.importFromContent('ws-1', 'b.txt', content);

      expect(r1.document.fileHash).toBe(r2.document.fileHash);
    });

    it('should produce different hash for different content', async () => {
      const r1 = await service.importFromContent('ws-1', 'a.txt', 'content A');
      const r2 = await service.importFromContent('ws-1', 'b.txt', 'content B');

      expect(r1.document.fileHash).not.toBe(r2.document.fileHash);
    });

    it('should persist document to database', async () => {
      const result = await service.importFromContent('ws-1', 'test.md', '# Title\n\nBody.');

      const row = db.db
        .prepare('SELECT * FROM documents WHERE id = ?')
        .get(result.document.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.file_name).toBe('test.md');
      expect(row.file_type).toBe('markdown');
      expect(row.status).toBe('ready');
      expect(row.workspace_id).toBe('ws-1');
    });

    it('should persist chapters to database', async () => {
      const content = `# A\n\nContent A.\n\n# B\n\nContent B.`;
      const result = await service.importFromContent('ws-1', 'test.md', content);

      const rows = db.db
        .prepare('SELECT * FROM chapters WHERE document_id = ? ORDER BY "index"')
        .all(result.document.id) as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0].title).toBe('A');
      expect(rows[1].title).toBe('B');
    });

    it('should store raw text in document', async () => {
      const content = '# Hello\n\nWorld.';
      const result = await service.importFromContent('ws-1', 'test.md', content);

      const row = db.db
        .prepare('SELECT raw_text FROM documents WHERE id = ?')
        .get(result.document.id) as { raw_text: string };
      expect(row.raw_text).toBe(content);
    });

    it('should throw for unsupported file format', async () => {
      await expect(
        service.importFromContent('ws-1', 'file.pdf', 'content'),
      ).rejects.toThrow('Unsupported file format: pdf');
    });

    it('should return chapter ids that match database ids', async () => {
      const content = `# Ch1\n\nBody.\n\n# Ch2\n\nBody.`;
      const result = await service.importFromContent('ws-1', 'test.md', content);

      for (const ch of result.chapters) {
        const row = db.db
          .prepare('SELECT id FROM chapters WHERE id = ?')
          .get(ch.id);
        expect(row).toBeDefined();
      }
    });

    it('should handle empty markdown', async () => {
      const result = await service.importFromContent('ws-1', 'empty.md', '');

      expect(result.document.id).toBeDefined();
      expect(result.chapters).toHaveLength(0);
    });

    it('should handle markdown with only one chapter', async () => {
      const content = '# Solo\n\nOnly chapter.';
      const result = await service.importFromContent('ws-1', 'solo.md', content);

      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe('Solo');
      expect(result.chapters[0].level).toBe(1);
    });

    it('should include chapter level in result', async () => {
      const content = `# H1\n\n## H2\n\n### H3`;
      const result = await service.importFromContent('ws-1', 'levels.md', content);

      expect(result.chapters[0].level).toBe(1);
      expect(result.chapters[1].level).toBe(2);
      expect(result.chapters[2].level).toBe(3);
    });
  });

  describe('listByWorkspace', () => {
    it('should return empty array when no documents exist', async () => {
      const list = await service.listByWorkspace('ws-1');
      expect(list).toHaveLength(0);
    });

    it('should list all documents in workspace', async () => {
      await service.importFromContent('ws-1', 'a.md', '# A\n\nContent A.');
      await service.importFromContent('ws-1', 'b.txt', 'Content B.');

      const list = await service.listByWorkspace('ws-1');
      expect(list).toHaveLength(2);
    });

    it('should return documents ordered by created_at descending', async () => {
      const r1 = await service.importFromContent('ws-1', 'first.md', '# First');
      await new Promise((r) => setTimeout(r, 10));
      const r2 = await service.importFromContent('ws-1', 'second.md', '# Second');

      const list = await service.listByWorkspace('ws-1');
      expect(list[0].id).toBe(r2.document.id);
      expect(list[1].id).toBe(r1.document.id);
    });

    it('should return document summaries without rawText', async () => {
      await service.importFromContent('ws-1', 'test.md', '# Hello\n\nWorld.');
      const list = await service.listByWorkspace('ws-1');

      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('fileName');
      expect(list[0]).toHaveProperty('fileType');
      expect(list[0]).toHaveProperty('fileHash');
      expect(list[0]).toHaveProperty('title');
      expect(list[0]).toHaveProperty('status');
      expect(list[0]).toHaveProperty('workspaceId');
      expect(list[0]).not.toHaveProperty('rawText');
    });

    it('should only return documents from specified workspace', async () => {
      // Create another workspace
      const now = new Date().toISOString();
      db.db
        .prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run('ws-2', 'Other Workspace', now, now);

      await service.importFromContent('ws-1', 'doc1.md', '# Doc 1');
      await service.importFromContent('ws-2', 'doc2.md', '# Doc 2');

      const list1 = await service.listByWorkspace('ws-1');
      const list2 = await service.listByWorkspace('ws-2');

      expect(list1).toHaveLength(1);
      expect(list1[0].fileName).toBe('doc1.md');
      expect(list2).toHaveLength(1);
      expect(list2[0].fileName).toBe('doc2.md');
    });
  });

  describe('getById', () => {
    it('should return null for non-existent document', async () => {
      const doc = await service.getById('non-existent-id');
      expect(doc).toBeNull();
    });

    it('should return document detail with rawText', async () => {
      const content = '# Hello\n\nWorld.';
      const result = await service.importFromContent('ws-1', 'test.md', content);
      const doc = await service.getById(result.document.id);

      expect(doc).not.toBeNull();
      expect(doc!.id).toBe(result.document.id);
      expect(doc!.fileName).toBe('test.md');
      expect(doc!.rawText).toBe(content);
      expect(doc!.workspaceId).toBe('ws-1');
    });

    it('should return document with chapters ordered by index', async () => {
      const content = `# Chapter A\n\nBody A.\n\n# Chapter B\n\nBody B.\n\n# Chapter C\n\nBody C.`;
      const result = await service.importFromContent('ws-1', 'test.md', content);
      const doc = await service.getById(result.document.id);

      expect(doc!.chapters).toHaveLength(3);
      expect(doc!.chapters[0].title).toBe('Chapter A');
      expect(doc!.chapters[0].index).toBe(0);
      expect(doc!.chapters[1].title).toBe('Chapter B');
      expect(doc!.chapters[1].index).toBe(1);
      expect(doc!.chapters[2].title).toBe('Chapter C');
      expect(doc!.chapters[2].index).toBe(2);
    });

    it('should return chapter content', async () => {
      const content = `# Title\n\nHello world.`;
      const result = await service.importFromContent('ws-1', 'test.md', content);
      const doc = await service.getById(result.document.id);

      expect(doc!.chapters[0].content).toContain('Hello world.');
    });

    it('should return empty chapters for document with no headings', async () => {
      const result = await service.importFromContent('ws-1', 'plain.txt', 'Just text.');
      const doc = await service.getById(result.document.id);

      expect(doc!.chapters).toHaveLength(1);
      expect(doc!.chapters[0].title).toBe('plain');
    });
  });

  describe('getFileType', () => {
    it('should detect markdown from .md extension', async () => {
      const result = await service.importFromContent('ws-1', 'f.md', '# H');
      expect(result.document.fileType).toBe('markdown');
    });

    it('should detect markdown from .markdown extension', async () => {
      const result = await service.importFromContent('ws-1', 'f.markdown', '# H');
      expect(result.document.fileType).toBe('markdown');
    });

    it('should detect txt from .txt extension', async () => {
      const result = await service.importFromContent('ws-1', 'f.txt', 'text');
      expect(result.document.fileType).toBe('txt');
    });

    it('should throw for unknown extension', async () => {
      await expect(
        service.importFromContent('ws-1', 'f.docx', 'content'),
      ).rejects.toThrow();
    });
  });
});
