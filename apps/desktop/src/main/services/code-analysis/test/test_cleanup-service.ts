import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisCleanupService } from '../cleanup-service';

// ── Test helpers ──────────────────────────────────────────────────────────────

function insertCleanupRow(
  db: DatabaseClient,
  overrides: {
    documentId?: string;
    relativePath?: string;
    attempts?: number;
    lastError?: string | null;
  } = {},
): { id: string; documentId: string; relativePath: string } {
  const id = randomUUID();
  const documentId = overrides.documentId ?? randomUUID();
  const relativePath = overrides.relativePath ?? `generated-documents/${documentId}`;
  const now = new Date().toISOString();
  const attempts = overrides.attempts ?? 0;
  const lastError = overrides.lastError === undefined ? null : overrides.lastError;

  db.db
    .prepare(
      `INSERT INTO analysis_file_cleanup_queue
         (id, document_id, relative_path, attempts, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, documentId, relativePath, attempts, lastError, now, now);

  return { id, documentId, relativePath };
}

function cleanupQueueCount(db: DatabaseClient): number {
  const row = db.db
    .prepare('SELECT COUNT(*) AS count FROM analysis_file_cleanup_queue')
    .get() as { count: number };
  return row.count;
}

function getQueueRow(
  db: DatabaseClient,
  id: string,
): { attempts: number; last_error: string | null } | undefined {
  return db.db
    .prepare('SELECT attempts, last_error FROM analysis_file_cleanup_queue WHERE id = ?')
    .get(id) as { attempts: number; last_error: string | null } | undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalysisCleanupService', () => {
  let db: DatabaseClient;
  let tmpDir: string;
  let service: AnalysisCleanupService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'cleanup-test-'));
    service = new AnalysisCleanupService(db, tmpDir);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── resolveManagedPath ────────────────────────────────────────────────────

  describe('resolveManagedPath', () => {
    it('resolves a valid generated-documents/<id> path', () => {
      const docId = randomUUID();
      const result = service.resolveManagedPath(`generated-documents/${docId}`);
      expect(result).toBe(join(tmpDir, 'generated-documents', docId));
    });

    it('rejects absolute paths', () => {
      expect(() => service.resolveManagedPath('/etc/passwd')).toThrow(/absolute/i);
      expect(() => service.resolveManagedPath('C:\\Windows\\System32')).toThrow(/absolute/i);
    });

    it('rejects directory traversal with ..', () => {
      expect(() => service.resolveManagedPath('generated-documents/../../etc/passwd')).toThrow(
        /traversal|\.\./i,
      );
    });

    it('rejects paths without generated-documents/ prefix', () => {
      expect(() => service.resolveManagedPath('other/file.txt')).toThrow(/prefix|generated-documents/i);
    });

    it('rejects empty string', () => {
      expect(() => service.resolveManagedPath('')).toThrow();
    });
  });

  // ── processPending ────────────────────────────────────────────────────────

  describe('processPending', () => {
    it('deletes file and removes queue entry on success', async () => {
      const docId = randomUUID();
      // Create the file on disk
      const dir = join(tmpDir, 'generated-documents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, docId), 'content');

      insertCleanupRow(db, {
        documentId: docId,
        relativePath: `generated-documents/${docId}`,
      });
      expect(cleanupQueueCount(db)).toBe(1);

      const result = await service.processPending();

      expect(result.processed).toBe(1);
      expect(result.pending).toBe(0);
      expect(cleanupQueueCount(db)).toBe(0);
    });

    it('treats ENOENT as success (file already gone)', async () => {
      insertCleanupRow(db);
      expect(cleanupQueueCount(db)).toBe(1);

      const result = await service.processPending();

      expect(result.processed).toBe(1);
      expect(result.pending).toBe(0);
      expect(cleanupQueueCount(db)).toBe(0);
    });

    it('increments attempts and records last_error on failure', async () => {
      // Create a directory at the path so unlink fails (EISDIR)
      const docId = randomUUID();
      const dir = join(tmpDir, 'generated-documents', docId);
      mkdirSync(dir, { recursive: true });

      const { id } = insertCleanupRow(db, {
        documentId: docId,
        relativePath: `generated-documents/${docId}`,
      });

      const result = await service.processPending();

      expect(result.processed).toBe(0);
      expect(result.pending).toBe(1);
      expect(cleanupQueueCount(db)).toBe(1);

      const row = getQueueRow(db, id);
      expect(row).toBeDefined();
      expect(row!.attempts).toBe(1);
      expect(row!.last_error).toBeTruthy();
    });

    it('only processes queue entries, does not scan directories', async () => {
      // Create files on disk but do NOT add to queue
      const dir = join(tmpDir, 'generated-documents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'orphan-file'), 'content');

      const result = await service.processPending();

      expect(result.processed).toBe(0);
      expect(result.pending).toBe(0);
      // The orphan file should still exist
      const { existsSync } = await import('fs');
      expect(existsSync(join(dir, 'orphan-file'))).toBe(true);
    });

    it('handles mixed results (success + ENOENT + failure)', async () => {
      // 1. File exists -> delete succeeds
      const docId1 = randomUUID();
      const dir = join(tmpDir, 'generated-documents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, docId1), 'content');
      insertCleanupRow(db, {
        documentId: docId1,
        relativePath: `generated-documents/${docId1}`,
      });

      // 2. File does not exist -> ENOENT success
      const docId2 = randomUUID();
      insertCleanupRow(db, {
        documentId: docId2,
        relativePath: `generated-documents/${docId2}`,
      });

      // 3. Path is a directory -> failure
      const docId3 = randomUUID();
      mkdirSync(join(dir, docId3), { recursive: true });
      insertCleanupRow(db, {
        documentId: docId3,
        relativePath: `generated-documents/${docId3}`,
      });

      const result = await service.processPending();

      expect(result.processed).toBe(2);
      expect(result.pending).toBe(1);
      expect(cleanupQueueCount(db)).toBe(1);
    });

    it('returns { processed: 0, pending: 0 } when queue is empty', async () => {
      const result = await service.processPending();
      expect(result.processed).toBe(0);
      expect(result.pending).toBe(0);
    });
  });
});
