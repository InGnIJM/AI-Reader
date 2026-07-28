import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerWorkspaceHandlers } from './workspace';
import { createDatabase, type DatabaseClient } from '../db/client';
import { WorkspaceService } from '../services/workspace';
import { IPC_CHANNELS } from '@ai-reader/shared';

// Mock Electron's ipcMain
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
}));

describe('Workspace IPC Handlers', () => {
  let db: DatabaseClient;
  let service: WorkspaceService;

  beforeEach(() => {
    handlers.clear();
    db = createDatabase(':memory:');
    service = new WorkspaceService(db);
    registerWorkspaceHandlers(service);
  });

  afterEach(() => {
    db.close();
  });

  // ── Registration ─────────────────────────────────────────────────────────

  it('should register all workspace handlers', () => {
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_CREATE)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_LIST)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.WORKSPACE_GET_BY_ID)).toBe(true);
  });

  // ── workspace:create ─────────────────────────────────────────────────────

  describe('workspace:create', () => {
    it('should create workspace and return success result', async () => {
      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_CREATE)!;
      const result = await handler({}, { name: 'Test Workspace' });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          id: expect.any(String),
          name: 'Test Workspace',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      });
    });

    it('should create workspace with description', async () => {
      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_CREATE)!;
      const result = await handler({}, { name: 'Test', description: 'A description' });

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          name: 'Test',
          description: 'A description',
        }),
      });
    });

    it('should create workspace without description', async () => {
      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_CREATE)!;
      const result = await handler({}, { name: 'No Desc' }) as { success: boolean; data: { description?: string } };

      expect(result.success).toBe(true);
      expect(result.data.description).toBeUndefined();
    });
  });

  // ── workspace:list ───────────────────────────────────────────────────────

  describe('workspace:list', () => {
    it('should return empty list when no workspaces exist', async () => {
      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_LIST)!;
      const result = await handler({});

      expect(result).toEqual({
        success: true,
        data: [],
      });
    });

    it('should return all workspaces', async () => {
      await service.create('WS 1');
      await service.create('WS 2');

      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_LIST)!;
      const result = await handler({}) as { success: boolean; data: unknown[] };

      expect(result).toEqual({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ name: 'WS 1' }),
          expect.objectContaining({ name: 'WS 2' }),
        ]),
      });
      expect(result.data).toHaveLength(2);
    });

    it('should return workspaces ordered by created_at descending', async () => {
      const ws1 = await service.create('First');
      await new Promise((r) => setTimeout(r, 10));
      const ws2 = await service.create('Second');

      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_LIST)!;
      const result = await handler({}) as { data: Array<{ id: string }> };

      expect(result.data[0].id).toBe(ws2.id);
      expect(result.data[1].id).toBe(ws1.id);
    });
  });

  // ── workspace:getById ────────────────────────────────────────────────────

  describe('workspace:getById', () => {
    it('should return workspace by id', async () => {
      const ws = await service.create('Find Me');

      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_GET_BY_ID)!;
      const result = await handler({}, ws.id);

      expect(result).toEqual({
        success: true,
        data: expect.objectContaining({
          id: ws.id,
          name: 'Find Me',
        }),
      });
    });

    it('should return null for non-existent workspace', async () => {
      const handler = handlers.get(IPC_CHANNELS.WORKSPACE_GET_BY_ID)!;
      const result = await handler({}, 'non-existent');

      expect(result).toEqual({
        success: true,
        data: null,
      });
    });
  });
});
