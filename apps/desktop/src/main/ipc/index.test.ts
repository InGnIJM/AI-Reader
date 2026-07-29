import { describe, it, expect, vi } from 'vitest';
import { registerAllHandlers } from './index';
import { createDatabase } from '../db/client';
import { IPC_CHANNELS } from '@ai-reader/shared';

// Mock Electron
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  app: {
    getVersion: () => '1.0.0',
    getPath: () => '/tmp',
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('IPC registerAllHandlers', () => {
  it('should register all IPC handlers', () => {
    const db = createDatabase(':memory:');
    registerAllHandlers(db, 'C:/local-documents');

    // System
    expect(handlers.has(IPC_CHANNELS.SYSTEM_GET_VERSION)).toBe(true);

    // Workspace
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_CREATE)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_LIST)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_GET_BY_ID)).toBe(true);

    // Document
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_IMPORT)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_LIST)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_GET_BY_ID)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.DOCUMENT_DELETE)).toBe(true);

    // Job
    expect(handlers.has(IPC_CHANNELS.JOB_CREATE)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_GET_BY_ID)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_LIST_BY_DOCUMENT)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_START)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_UPDATE_PROGRESS)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_MARK_COMPLETED)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.JOB_MARK_FAILED)).toBe(true);

    // Dialog
    expect(handlers.has(IPC_CHANNELS.DIALOG_OPEN_FILE)).toBe(true);

    db.close();
  });
});
