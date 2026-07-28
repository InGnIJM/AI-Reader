import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock electron's ipcMain
const handles = new Map<string, Function>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handles.set(channel, handler);
    }),
  },
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/tmp'),
  },
}));

import { registerJobHandlers } from './jobs';
import { createDatabase, type DatabaseClient } from '../db/client';
import { GenerationJobService } from '../services/generation-job';
import { IPC_CHANNELS } from '@ai-reader/shared';

describe('Job IPC Handlers', () => {
  let db: DatabaseClient;
  let service: GenerationJobService;

  beforeEach(() => {
    handles.clear();
    db = createDatabase(':memory:');
    service = new GenerationJobService(db);

    // Create workspace and document for foreign key
    const now = new Date().toISOString();
    db.db
      .prepare('INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('ws-1', 'Test Workspace', now, now);
    db.db
      .prepare(
        'INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, raw_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('doc-1', 'ws-1', 'test.md', 'markdown', 'abc123', 'content', now, now);

    registerJobHandlers(service);
  });

  afterEach(() => {
    db.close();
  });

  describe('job:create', () => {
    it('should create job and return success result', async () => {
      const handler = handles.get(IPC_CHANNELS.JOB_CREATE)!;
      const result = await handler({}, { documentId: 'doc-1', totalSections: 5 });

      expect(result.success).toBe(true);
      expect(result.data.documentId).toBe('doc-1');
      expect(result.data.status).toBe('pending');
      expect(result.data.totalSections).toBe(5);
    });
  });

  describe('job:getById', () => {
    it('should return job by id', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });

      const handler = handles.get(IPC_CHANNELS.JOB_GET_BY_ID)!;
      const result = await handler({}, job.id);

      expect(result.success).toBe(true);
      expect(result.data).not.toBeNull();
      expect(result.data!.id).toBe(job.id);
    });

    it('should return null for non-existent id', async () => {
      const handler = handles.get(IPC_CHANNELS.JOB_GET_BY_ID)!;
      const result = await handler({}, 'non-existent');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe('job:listByDocument', () => {
    it('should return jobs for document', async () => {
      await service.create({ documentId: 'doc-1', totalSections: 3 });
      await service.create({ documentId: 'doc-1', totalSections: 5 });

      const handler = handles.get(IPC_CHANNELS.JOB_LIST_BY_DOCUMENT)!;
      const result = await handler({}, 'doc-1');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should return empty array when no jobs exist', async () => {
      const handler = handles.get(IPC_CHANNELS.JOB_LIST_BY_DOCUMENT)!;
      const result = await handler({}, 'doc-1');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('job:start', () => {
    it('should start job and update status', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });

      const handler = handles.get(IPC_CHANNELS.JOB_START)!;
      const result = await handler({}, job.id);

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('running');
    });
  });

  describe('job:updateProgress', () => {
    it('should update job progress', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      await service.start(job.id);

      const handler = handles.get(IPC_CHANNELS.JOB_UPDATE_PROGRESS)!;
      const result = await handler({}, { id: job.id, completedSections: 3 });

      expect(result.success).toBe(true);
      expect(result.data!.completedSections).toBe(3);
    });
  });

  describe('job:markCompleted', () => {
    it('should mark job as completed', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });

      const handler = handles.get(IPC_CHANNELS.JOB_MARK_COMPLETED)!;
      const result = await handler({}, job.id);

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('completed');
    });
  });

  describe('job:markFailed', () => {
    it('should mark job as failed with error message', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });

      const handler = handles.get(IPC_CHANNELS.JOB_MARK_FAILED)!;
      const result = await handler({}, { id: job.id, errorMessage: 'LLM timeout' });

      expect(result.success).toBe(true);
      expect(result.data!.status).toBe('failed');
      expect(result.data!.errorMessage).toBe('LLM timeout');
    });
  });
});
