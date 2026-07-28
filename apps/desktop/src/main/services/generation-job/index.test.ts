import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GenerationJobService } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('GenerationJobService', () => {
  let db: DatabaseClient;
  let service: GenerationJobService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    service = new GenerationJobService(db);

    // 创建一个工作区和文档用于外键约束
    db.db
      .prepare(
        `INSERT INTO workspaces (id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run('ws-1', 'Test Workspace', new Date().toISOString(), new Date().toISOString());

    db.db
      .prepare(
        `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, raw_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'doc-1',
        'ws-1',
        'test.md',
        'markdown',
        'abc123',
        'Test content',
        new Date().toISOString(),
        new Date().toISOString(),
      );
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a job with pending status', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });

      expect(job.id).toBeDefined();
      expect(typeof job.id).toBe('string');
      expect(job.id.length).toBeGreaterThan(0);
      expect(job.documentId).toBe('doc-1');
      expect(job.status).toBe('pending');
      expect(job.totalSections).toBe(5);
      expect(job.completedSections).toBe(0);
      expect(job.errorMessage).toBeUndefined();
      expect(job.createdAt).toBeDefined();
      expect(job.updatedAt).toBeDefined();
    });

    it('should generate unique ids for different jobs', async () => {
      const job1 = await service.create({ documentId: 'doc-1', totalSections: 3 });
      const job2 = await service.create({ documentId: 'doc-1', totalSections: 5 });
      expect(job1.id).not.toBe(job2.id);
    });

    it('should persist job to database', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const row = db.db
        .prepare('SELECT * FROM generation_jobs WHERE id = ?')
        .get(job.id) as Record<string, unknown>;

      expect(row).toBeDefined();
      expect(row.document_id).toBe('doc-1');
      expect(row.status).toBe('pending');
      expect(row.total_sections).toBe(5);
      expect(row.completed_sections).toBe(0);
    });
  });

  describe('getById', () => {
    it('should return job by id', async () => {
      const created = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const found = await service.getById(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.documentId).toBe('doc-1');
      expect(found!.status).toBe('pending');
    });

    it('should return null for non-existent id', async () => {
      const found = await service.getById('non-existent-id');
      expect(found).toBeNull();
    });
  });

  describe('listByDocument', () => {
    it('should return empty array when no jobs exist', async () => {
      const list = await service.listByDocument('doc-1');
      expect(list).toHaveLength(0);
    });

    it('should list all jobs for a document', async () => {
      await service.create({ documentId: 'doc-1', totalSections: 3 });
      await service.create({ documentId: 'doc-1', totalSections: 5 });
      const list = await service.listByDocument('doc-1');
      expect(list).toHaveLength(2);
    });

    it('should return jobs ordered by created_at descending', async () => {
      const job1 = await service.create({ documentId: 'doc-1', totalSections: 3 });
      await new Promise((r) => setTimeout(r, 10));
      const job2 = await service.create({ documentId: 'doc-1', totalSections: 5 });

      const list = await service.listByDocument('doc-1');
      expect(list[0].id).toBe(job2.id);
      expect(list[1].id).toBe(job1.id);
    });

    it('should only return jobs for the specified document', async () => {
      // 创建另一个文档
      db.db
        .prepare(
          `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, raw_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'doc-2',
          'ws-1',
          'test2.md',
          'markdown',
          'def456',
          'Test content 2',
          new Date().toISOString(),
          new Date().toISOString(),
        );

      await service.create({ documentId: 'doc-1', totalSections: 3 });
      await service.create({ documentId: 'doc-2', totalSections: 5 });

      const list = await service.listByDocument('doc-1');
      expect(list).toHaveLength(1);
      expect(list[0].documentId).toBe('doc-1');
    });
  });

  describe('start', () => {
    it('should update job status to running', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const started = await service.start(job.id);

      expect(started).not.toBeNull();
      expect(started!.status).toBe('running');
    });

    it('should update updated_at timestamp', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const originalUpdatedAt = job.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      const started = await service.start(job.id);

      expect(started!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return null for non-existent job', async () => {
      const result = await service.start('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('updateProgress', () => {
    it('should update completed sections count', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const updated = await service.updateProgress(job.id, 3);

      expect(updated).not.toBeNull();
      expect(updated!.completedSections).toBe(3);
    });

    it('should update updated_at timestamp', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const originalUpdatedAt = job.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      const updated = await service.updateProgress(job.id, 3);

      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return null for non-existent job', async () => {
      const result = await service.updateProgress('non-existent-id', 3);
      expect(result).toBeNull();
    });

    it('should allow updating progress multiple times', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });

      await service.updateProgress(job.id, 1);
      await service.updateProgress(job.id, 3);
      const final = await service.updateProgress(job.id, 5);

      expect(final!.completedSections).toBe(5);
    });
  });

  describe('markCompleted', () => {
    it('should update job status to completed', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const completed = await service.markCompleted(job.id);

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
    });

    it('should update updated_at timestamp', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const originalUpdatedAt = job.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      const completed = await service.markCompleted(job.id);

      expect(completed!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return null for non-existent job', async () => {
      const result = await service.markCompleted('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('markFailed', () => {
    it('should update job status to failed', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const failed = await service.markFailed(job.id, 'LLM timeout');

      expect(failed).not.toBeNull();
      expect(failed!.status).toBe('failed');
    });

    it('should set error message', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const failed = await service.markFailed(job.id, 'LLM timeout');

      expect(failed!.errorMessage).toBe('LLM timeout');
    });

    it('should update updated_at timestamp', async () => {
      const job = await service.create({ documentId: 'doc-1', totalSections: 5 });
      const originalUpdatedAt = job.updatedAt;

      await new Promise((r) => setTimeout(r, 10));
      const failed = await service.markFailed(job.id, 'LLM timeout');

      expect(failed!.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should return null for non-existent job', async () => {
      const result = await service.markFailed('non-existent-id', 'error');
      expect(result).toBeNull();
    });
  });

  describe('full lifecycle', () => {
    it('should support complete job lifecycle', async () => {
      // 创建任务
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });
      expect(job.status).toBe('pending');

      // 开始任务
      const started = await service.start(job.id);
      expect(started!.status).toBe('running');

      // 更新进度
      await service.updateProgress(job.id, 1);
      await service.updateProgress(job.id, 2);
      const withProgress = await service.getById(job.id);
      expect(withProgress!.completedSections).toBe(2);

      // 标记完成
      const completed = await service.markCompleted(job.id);
      expect(completed!.status).toBe('completed');
      expect(completed!.completedSections).toBe(2);
    });

    it('should support failed job lifecycle', async () => {
      // 创建任务
      const job = await service.create({ documentId: 'doc-1', totalSections: 3 });

      // 开始任务
      await service.start(job.id);

      // 更新进度
      await service.updateProgress(job.id, 1);

      // 标记失败
      const failed = await service.markFailed(job.id, 'API rate limit exceeded');
      expect(failed!.status).toBe('failed');
      expect(failed!.errorMessage).toBe('API rate limit exceeded');
      expect(failed!.completedSections).toBe(1);
    });
  });
});
