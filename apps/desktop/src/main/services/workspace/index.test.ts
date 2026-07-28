import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceService } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('WorkspaceService', () => {
  let db: DatabaseClient;
  let service: WorkspaceService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    service = new WorkspaceService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create workspace with name', async () => {
      const ws = await service.create('Test Workspace');
      expect(ws.id).toBeDefined();
      expect(typeof ws.id).toBe('string');
      expect(ws.id.length).toBeGreaterThan(0);
      expect(ws.name).toBe('Test Workspace');
      expect(ws.createdAt).toBeDefined();
      expect(ws.updatedAt).toBeDefined();
    });

    it('should create workspace with optional description', async () => {
      const ws = await service.create('My Workspace', 'A description');
      expect(ws.name).toBe('My Workspace');
      expect(ws.description).toBe('A description');
    });

    it('should create workspace without description', async () => {
      const ws = await service.create('No Desc');
      expect(ws.description).toBeUndefined();
    });

    it('should generate unique ids for different workspaces', async () => {
      const ws1 = await service.create('WS 1');
      const ws2 = await service.create('WS 2');
      expect(ws1.id).not.toBe(ws2.id);
    });

    it('should persist workspace to database', async () => {
      const ws = await service.create('Persisted');
      const row = db.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(ws.id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.name).toBe('Persisted');
    });
  });

  describe('list', () => {
    it('should return empty array when no workspaces exist', async () => {
      const list = await service.list();
      expect(list).toHaveLength(0);
    });

    it('should list all workspaces', async () => {
      await service.create('WS 1');
      await service.create('WS 2');
      const list = await service.list();
      expect(list).toHaveLength(2);
    });

    it('should return workspaces ordered by created_at descending', async () => {
      const ws1 = await service.create('First');
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const ws2 = await service.create('Second');
      const list = await service.list();
      expect(list[0].id).toBe(ws2.id);
      expect(list[1].id).toBe(ws1.id);
    });
  });

  describe('getById', () => {
    it('should return workspace by id', async () => {
      const created = await service.create('Find Me');
      const found = await service.getById(created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe('Find Me');
    });

    it('should return null for non-existent id', async () => {
      const found = await service.getById('non-existent-id');
      expect(found).toBeNull();
    });
  });
});
