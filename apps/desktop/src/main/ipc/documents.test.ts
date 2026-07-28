import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerDocumentHandlers } from './documents';
import { createDatabase, type DatabaseClient } from '../db/client';
import { DocumentImportService } from '../services/document-import';
import { IPC_CHANNELS } from '@ai-reader/shared';

// Mock Electron's ipcMain, dialog, BrowserWindow
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => ({ id: 1 })),
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { dialog } from 'electron';
import { readFile } from 'fs/promises';

describe('Document IPC Handlers', () => {
  let db: DatabaseClient;
  let service: DocumentImportService;

  beforeEach(() => {
    handlers.clear();
    db = createDatabase(':memory:');
    // Create prerequisite workspace
    const now = new Date().toISOString();
    db.db
      .prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('ws-1', 'Test Workspace', now, now);
    service = new DocumentImportService(db);
    registerDocumentHandlers(service);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  // ── Registration ─────────────────────────────────────────────────────────

  it('should register all document handlers', () => {
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_IMPORT)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_LIST)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_GET_BY_ID)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_DELETE)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DIALOG_OPEN_FILE)).toBe(true);
  });

  // ── document:import ──────────────────────────────────────────────────────

  describe('document:import', () => {
    it('should import document and return success result', async () => {
      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_IMPORT)!;
      const result = await handler({}, {
        workspaceId: 'ws-1',
        fileName: 'test.md',
        content: '# Hello\n\nWorld.',
      });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          document: expect.objectContaining({
            id: expect.any(String),
            fileName: 'test.md',
            fileType: 'markdown',
            status: 'ready',
          }),
          chapters: expect.arrayContaining([
            expect.objectContaining({ title: 'Hello' }),
          ]),
        }),
      });
    });

    it('should return error result for unsupported format', async () => {
      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_IMPORT)!;
      const result = await handler({}, {
        workspaceId: 'ws-1',
        fileName: 'file.docx',
        content: 'content',
      });

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('Unsupported file format'),
      });
    });
  });

  // ── document:list ────────────────────────────────────────────────────────

  describe('document:list', () => {
    it('should return empty list when no documents exist', async () => {
      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_LIST)!;
      const result = await handler({}, 'ws-1');

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it('should return all documents in workspace', async () => {
      await service.importFromContent('ws-1', 'a.md', '# A\n\nContent A.');
      await service.importFromContent('ws-1', 'b.txt', 'Content B.');

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_LIST)!;
      const result = await handler({}, 'ws-1');

      expect(result).toEqual({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ fileName: 'a.md' }),
          expect.objectContaining({ fileName: 'b.txt' }),
        ]),
      });
    });
  });

  // ── document:getById ─────────────────────────────────────────────────────

  describe('document:getById', () => {
    it('should return document detail with chapters', async () => {
      const imported = await service.importFromContent('ws-1', 'test.md', '# Title\n\nBody.');

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_GET_BY_ID)!;
      const result = await handler({}, imported.document.id);

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          id: imported.document.id,
          fileName: 'test.md',
          rawText: '# Title\n\nBody.',
          chapters: expect.arrayContaining([
            expect.objectContaining({ title: 'Title' }),
          ]),
        }),
      });
    });

    it('should return null for non-existent document', async () => {
      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_GET_BY_ID)!;
      const result = await handler({}, 'non-existent');

      expect(result).toEqual({
        success: true,
        data: null,
      });
    });
  });

  // ── document:getChapters ─────────────────────────────────────────────────

  describe('document:getChapters', () => {
    it('should return chapters for document', async () => {
      const imported = await service.importFromContent(
        'ws-1',
        'test.md',
        '# Ch1\n\nBody 1.\n\n# Ch2\n\nBody 2.',
      );

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS)!;
      const result = await handler({}, imported.document.id);

      expect(result).toEqual({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ title: 'Ch1', level: 1 }),
          expect.objectContaining({ title: 'Ch2', level: 1 }),
        ]),
      });
      expect((result as { data: unknown[] }).data).toHaveLength(2);
    });

    it('should return empty array for non-existent document', async () => {
      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS)!;
      const result = await handler({}, 'non-existent');

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it('should return chapters ordered by index', async () => {
      const imported = await service.importFromContent(
        'ws-1',
        'ordered.md',
        '# First\n\nA.\n\n# Second\n\nB.\n\n# Third\n\nC.',
      );

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS)!;
      const result = await handler({}, imported.document.id) as { data: Array<{ title: string; index: number }> };

      expect(result.data[0].title).toBe('First');
      expect(result.data[0].index).toBe(0);
      expect(result.data[1].title).toBe('Second');
      expect(result.data[1].index).toBe(1);
      expect(result.data[2].title).toBe('Third');
      expect(result.data[2].index).toBe(2);
    });
  });

  // ── document:delete ──────────────────────────────────────────────────────

  describe('document:delete', () => {
    it('should delete existing document and return true', async () => {
      const imported = await service.importFromContent('ws-1', 'test.md', '# Hello');

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_DELETE)!;
      const result = await handler({}, imported.document.id);

      expect(result).toEqual({
        success: true,
        data: true,
      });

      // Verify document is actually deleted
      const doc = await service.getById(imported.document.id);
      expect(doc).toBeNull();
    });

    it('should cascade delete chapters when document is deleted', async () => {
      const imported = await service.importFromContent(
        'ws-1',
        'test.md',
        '# Ch1\n\nBody.\n\n# Ch2\n\nBody.',
      );

      // Verify chapters exist before delete
      const beforeDoc = await service.getById(imported.document.id);
      expect(beforeDoc!.chapters).toHaveLength(2);

      const handler = handlers.get(IPC_CHANNELS.DOCUMENT_DELETE)!;
      await handler({}, imported.document.id);

      // Verify chapters are gone
      const chapters = db.db
        .prepare('SELECT * FROM chapters WHERE document_id = ?')
        .all(imported.document.id);
      expect(chapters).toHaveLength(0);
    });
  });

  // ── dialog:openFile ──────────────────────────────────────────────────────

  describe('dialog:openFile', () => {
    it('should return file contents when files are selected', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/test.md', '/path/to/notes.txt'],
      });
      vi.mocked(readFile)
        .mockResolvedValueOnce('# Hello\n\nWorld.')
        .mockResolvedValueOnce('Plain text content.');

      const handler = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE)!;
      const result = await handler({ sender: {} });

      expect(result).toEqual({
        success: true,
        data: {
          canceled: false,
          filePaths: ['/path/to/test.md', '/path/to/notes.txt'],
          fileContents: [
            { name: 'test.md', content: '# Hello\n\nWorld.' },
            { name: 'notes.txt', content: 'Plain text content.' },
          ],
        },
      });
    });

    it('should return canceled when dialog is canceled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const handler = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE)!;
      const result = await handler({ sender: {} });

      expect(result).toEqual({
        success: true,
        data: {
          canceled: true,
          filePaths: [],
        },
      });
    });

    it('should return error when no parent window found', async () => {
      const { BrowserWindow } = await import('electron');
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);

      const handler = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE)!;
      const result = await handler({ sender: {} });

      expect(result).toEqual({
        success: false,
        error: 'No parent window found',
      });
    });

    it('should return error when file read fails', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/path/to/bad.md'],
      });
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: file not found'));

      const handler = handlers.get(IPC_CHANNELS.DIALOG_OPEN_FILE)!;
      const result = await handler({ sender: {} });

      expect(result).toEqual({
        success: false,
        error: 'ENOENT: file not found',
      });
    });
  });
});
