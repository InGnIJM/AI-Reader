import { randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisSessionService } from '../session-service';
import type { AnalysisSession, AnalysisSessionDetail } from '@ai-reader/shared';

// ── Test helpers ──────────────────────────────────────────────────────────────

function insertProject(db: DatabaseClient, name = 'Test Project'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, `/projects/${id}`, `hash-${id}`, now, now);
  return id;
}

function insertSession(
  db: DatabaseClient,
  overrides: {
    projectId?: string | null;
    title?: string;
    status?: 'active' | 'archived';
  } = {},
): { sessionId: string; branchId: string; documentId: string } {
  const sessionId = randomUUID();
  const branchId = randomUUID();
  const documentId = randomUUID();
  const now = new Date().toISOString();
  const title = overrides.title ?? 'Test Session';
  const status = overrides.status ?? 'active';
  const projectId = overrides.projectId === undefined ? null : overrides.projectId;

  // 1. Create session with NULL active pointers (trigger-safe)
  db.db
    .prepare(
      `INSERT INTO analysis_sessions
         (id, project_id, title, status, active_branch_id, active_document_id, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    )
    .run(
      sessionId,
      projectId,
      title,
      status,
      status === 'archived' ? now : null,
      now,
      now,
    );

  // 2. Create branch with NULL head (trigger-safe)
  db.db
    .prepare(
      `INSERT INTO analysis_branches
         (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(branchId, sessionId, '主分支', now, now);

  // 3. Create document
  db.db
    .prepare(
      `INSERT INTO analysis_documents
         (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, '', 'completed', NULL, 0, ?, ?)`,
    )
    .run(documentId, sessionId, branchId, 'Test goal', now, now);

  // 4. Update branch head
  db.db
    .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
    .run(documentId, branchId);

  // 5. Update session active pointers
  db.db
    .prepare('UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ? WHERE id = ?')
    .run(branchId, documentId, sessionId);

  return { sessionId, branchId, documentId };
}

function insertDocument(
  db: DatabaseClient,
  sessionId: string,
  branchId: string,
  overrides: { parentDocumentId?: string | null; goal?: string } = {},
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO analysis_documents
         (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'completed', NULL, 0, ?, ?)`,
    )
    .run(id, sessionId, branchId, overrides.parentDocumentId ?? null, overrides.goal ?? 'Child goal', now, now);
  return id;
}

function sessionRowCount(db: DatabaseClient, status?: 'active' | 'archived'): number {
  const where = status ? 'WHERE status = ?' : '';
  const row = (status
    ? db.db.prepare(`SELECT COUNT(*) AS count FROM analysis_sessions ${where}`).get(status)
    : db.db.prepare(`SELECT COUNT(*) AS count FROM analysis_sessions`).get()) as { count: number };
  return row.count;
}

function cleanupQueueCount(db: DatabaseClient): number {
  const row = db.db.prepare('SELECT COUNT(*) AS count FROM analysis_file_cleanup_queue').get() as {
    count: number;
  };
  return row.count;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalysisSessionService', () => {
  let db: DatabaseClient;
  let service: AnalysisSessionService;
  let mockCleanup: { processPending: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = createDatabase(':memory:');
    mockCleanup = { processPending: vi.fn().mockResolvedValue({ processed: 0, pending: 0 }) };
    service = new AnalysisSessionService(db, mockCleanup);
  });

  afterEach(() => {
    db.close();
  });

  // ── listByProject ─────────────────────────────────────────────────────────

  describe('listByProject', () => {
    it('returns sessions for a given project and status', async () => {
      const projectId = insertProject(db);
      insertSession(db, { projectId, title: 'Session A', status: 'active' });
      insertSession(db, { projectId, title: 'Session B', status: 'active' });
      insertSession(db, { projectId, title: 'Archived Session', status: 'archived' });

      const active = await service.listByProject(projectId, 'active');
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.title)).toEqual(expect.arrayContaining(['Session A', 'Session B']));

      const archived = await service.listByProject(projectId, 'archived');
      expect(archived).toHaveLength(1);
      expect(archived[0].title).toBe('Archived Session');
    });

    it('returns no-project sessions when projectId is null', async () => {
      insertSession(db, { projectId: null, title: 'No Project Session' });
      insertSession(db, { projectId: insertProject(db), title: 'Has Project' });

      const result = await service.listByProject(null, 'active');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('No Project Session');
    });

    it('returns empty array when no sessions match', async () => {
      const result = await service.listByProject('nonexistent', 'active');
      expect(result).toEqual([]);
    });

    it('orders sessions by updated_at DESC', async () => {
      const projectId = insertProject(db);
      const first = insertSession(db, { projectId, title: 'Older' });
      // Force an earlier timestamp on the second session
      db.db
        .prepare('UPDATE analysis_sessions SET updated_at = ? WHERE id = ?')
        .run('2020-01-01T00:00:00.000Z', first.sessionId);

      const second = insertSession(db, { projectId, title: 'Newer' });

      const result = await service.listByProject(projectId, 'active');
      expect(result[0].title).toBe('Newer');
      expect(result[1].title).toBe('Older');
    });
  });

  // ── listRecent ────────────────────────────────────────────────────────────

  describe('listRecent', () => {
    it('returns recent sessions across all projects', async () => {
      const proj1 = insertProject(db, 'Project 1');
      const proj2 = insertProject(db, 'Project 2');
      insertSession(db, { projectId: proj1, title: 'S1' });
      insertSession(db, { projectId: proj2, title: 'S2' });
      insertSession(db, { projectId: null, title: 'S3' });

      const result = await service.listRecent({ status: 'active' });
      expect(result).toHaveLength(3);
    });

    it('filters by status', async () => {
      insertSession(db, { title: 'Active', status: 'active' });
      insertSession(db, { title: 'Archived', status: 'archived' });

      const active = await service.listRecent({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('Active');
    });

    it('respects limit parameter', async () => {
      insertSession(db, { title: 'S1' });
      insertSession(db, { title: 'S2' });
      insertSession(db, { title: 'S3' });

      const result = await service.listRecent({ status: 'active', limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('clamps limit to valid range 1-100', async () => {
      insertSession(db, { title: 'S1' });

      const tooLow = await service.listRecent({ status: 'active', limit: -5 });
      expect(tooLow).toHaveLength(1);

      const tooHigh = await service.listRecent({ status: 'active', limit: 999 });
      expect(tooHigh).toHaveLength(1);
    });

    it('defaults limit to 20', async () => {
      for (let i = 0; i < 25; i++) {
        insertSession(db, { title: `Session ${i}` });
      }
      const result = await service.listRecent({ status: 'active' });
      expect(result).toHaveLength(20);
    });
  });

  // ── getDetail ─────────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('returns session with branches and turns', async () => {
      const { sessionId, branchId, documentId } = insertSession(db);

      const detail = await service.getDetail(sessionId);
      expect(detail).not.toBeNull();
      expect(detail!.session.id).toBe(sessionId);
      expect(detail!.branches).toHaveLength(1);
      expect(detail!.branches[0].id).toBe(branchId);
      expect(detail!.turns).toHaveLength(1);
      expect(detail!.turns[0].id).toBe(documentId);
    });

    it('returns null for nonexistent session', async () => {
      const detail = await service.getDetail('nonexistent');
      expect(detail).toBeNull();
    });

    it('includes multiple branches and turns', async () => {
      const { sessionId, branchId: mainBranchId, documentId: firstTurn } = insertSession(db);

      // Add a second turn to the main branch
      const secondTurn = insertDocument(db, sessionId, mainBranchId, {
        parentDocumentId: firstTurn,
        goal: 'Second turn',
      });
      db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(secondTurn, mainBranchId);

      // Add a fork branch (create with NULL head first, then document, then update head)
      const forkBranchId = randomUUID();
      const forkTurnId = randomUUID();
      const now = new Date().toISOString();
      db.db
        .prepare(
          `INSERT INTO analysis_branches
             (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(forkBranchId, sessionId, '分支 2', mainBranchId, firstTurn, now, now);
      db.db
        .prepare(
          `INSERT INTO analysis_documents
             (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '', 'completed', 0, ?, ?)`,
        )
        .run(forkTurnId, sessionId, forkBranchId, firstTurn, 'Fork turn', now, now);
      db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(forkTurnId, forkBranchId);

      const detail = await service.getDetail(sessionId);
      expect(detail!.branches).toHaveLength(2);
      expect(detail!.turns).toHaveLength(3);
    });
  });

  // ── rename ────────────────────────────────────────────────────────────────

  describe('rename', () => {
    it('renames a session with a valid title', async () => {
      const { sessionId } = insertSession(db, { title: 'Original' });
      const renamed = await service.rename(sessionId, 'New Title');
      expect(renamed.title).toBe('New Title');
    });

    it('trims whitespace from title', async () => {
      const { sessionId } = insertSession(db);
      const renamed = await service.rename(sessionId, '  Trimmed Title  ');
      expect(renamed.title).toBe('Trimmed Title');
    });

    it('rejects empty title', async () => {
      const { sessionId } = insertSession(db);
      await expect(service.rename(sessionId, '')).rejects.toThrow(/INVALID_TITLE/);
      await expect(service.rename(sessionId, '   ')).rejects.toThrow(/INVALID_TITLE/);
    });

    it('rejects title exceeding 80 characters', async () => {
      const { sessionId } = insertSession(db);
      const longTitle = 'a'.repeat(81);
      await expect(service.rename(sessionId, longTitle)).rejects.toThrow(/INVALID_TITLE/);
    });

    it('accepts title at exactly 80 characters', async () => {
      const { sessionId } = insertSession(db);
      const title80 = 'b'.repeat(80);
      const renamed = await service.rename(sessionId, title80);
      expect(renamed.title).toBe(title80);
    });

    it('accepts title at exactly 1 character', async () => {
      const { sessionId } = insertSession(db);
      const renamed = await service.rename(sessionId, 'X');
      expect(renamed.title).toBe('X');
    });

    it('rejects rename of nonexistent session', async () => {
      await expect(service.rename('nonexistent', 'Title')).rejects.toThrow(/SESSION_NOT_FOUND/);
    });
  });

  // ── archive ───────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('archives an active session', async () => {
      const { sessionId } = insertSession(db, { status: 'active' });
      const archived = await service.archive(sessionId);
      expect(archived.status).toBe('archived');
      expect(archived.archivedAt).toBeTruthy();
    });

    it('rejects archive of nonexistent session', async () => {
      await expect(service.archive('nonexistent')).rejects.toThrow(/SESSION_NOT_FOUND/);
    });

    it('rejects archive of already archived session', async () => {
      const { sessionId } = insertSession(db, { status: 'archived' });
      await expect(service.archive(sessionId)).rejects.toThrow(/SESSION_ARCHIVED/);
    });
  });

  // ── restore ───────────────────────────────────────────────────────────────

  describe('restore', () => {
    it('restores an archived session', async () => {
      const { sessionId } = insertSession(db, { status: 'archived' });
      const restored = await service.restore(sessionId);
      expect(restored.status).toBe('active');
      expect(restored.archivedAt).toBeNull();
    });

    it('rejects restore of nonexistent session', async () => {
      await expect(service.restore('nonexistent')).rejects.toThrow(/SESSION_NOT_FOUND/);
    });

    it('rejects restore of already active session', async () => {
      const { sessionId } = insertSession(db, { status: 'active' });
      await expect(service.restore(sessionId)).rejects.toThrow(/SESSION_ARCHIVED/);
    });
  });

  // ── deletePermanently ─────────────────────────────────────────────────────

+  describe('forkAsIndependentSession', () => {
    it('copies the selected turn path and its related records into an independent session', async () => {
      const { sessionId, branchId, documentId: rootDocumentId } = insertSession(db);
      const secondDocumentId = insertDocument(db, sessionId, branchId, {
        parentDocumentId: rootDocumentId,
        goal: 'Second turn',
      });
      const now = new Date().toISOString();
      db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(secondDocumentId, branchId);
      db.db
        .prepare(
          'UPDATE analysis_sessions SET active_document_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(secondDocumentId, now, sessionId);

      const rootTraceId = randomUUID();
      const secondTraceId = randomUUID();
      const annotationId = randomUUID();
      const messageId = randomUUID();
      const insertTrace = db.db.prepare(
        `INSERT INTO analysis_tool_traces
           (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insertTrace.run(rootTraceId, rootDocumentId, 0, 'read_file', '{}', 'root trace', now);
      insertTrace.run(secondTraceId, secondDocumentId, 1, 'search', '{}', 'second trace', now);
      db.db
        .prepare(
          `INSERT INTO analysis_annotations
             (id, analysis_document_id, anchor_start_offset, anchor_end_offset,
              anchor_exact_text, selected_text, anchor_prefix, anchor_suffix,
              question, status, created_at, updated_at)
           VALUES (?, ?, 0, 4, 'Test', 'Test', '', '', 'Why?', 'answered', ?, ?)`,
        )
        .run(annotationId, rootDocumentId, now, now);
      db.db
        .prepare(
          `INSERT INTO analysis_discussion_messages
             (id, annotation_id, role, content, model_id, created_at)
           VALUES (?, ?, 'assistant', 'Because.', 'test-model', ?)`,
        )
        .run(messageId, annotationId, now);

      const clonedSession = await service.forkAsIndependentSession({
        sessionId,
        documentId: secondDocumentId,
      });

      const clonedDetail = await service.getDetail(clonedSession.id);
      expect(clonedDetail?.session).toMatchObject({
        title: 'Test Session · Branch',
        status: 'active',
      });
      expect(clonedDetail?.branches).toHaveLength(1);
      expect(clonedDetail?.branches[0]).toMatchObject({
        parentBranchId: null,
        forkedFromDocumentId: null,
      });
      expect(clonedDetail?.turns.map((turn) => turn.goal)).toEqual(['Test goal', 'Second turn']);
      expect(clonedDetail?.turns[1]?.parentDocumentId).toBe(clonedDetail?.turns[0]?.id);
      expect(clonedDetail?.session.activeDocumentId).toBe(clonedDetail?.turns[1]?.id);

      const copiedTraceCount = db.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM analysis_tool_traces AS trace
           JOIN analysis_documents AS document ON document.id = trace.analysis_document_id
           WHERE document.session_id = ?`,
        )
        .get(clonedSession.id) as { count: number };
      expect(copiedTraceCount.count).toBe(2);
      const copiedAnnotation = db.db
        .prepare(
          `SELECT annotation.id, annotation.analysis_document_id
           FROM analysis_annotations AS annotation
           JOIN analysis_documents AS document ON document.id = annotation.analysis_document_id
           WHERE document.session_id = ?`,
        )
        .get(clonedSession.id) as { id: string; analysis_document_id: string };
      expect(copiedAnnotation).toMatchObject({
        analysis_document_id: clonedDetail?.turns[0]?.id,
      });
      expect(copiedAnnotation.id).not.toBe(annotationId);
      expect(
        db.db
          .prepare('SELECT annotation_id FROM analysis_discussion_messages WHERE annotation_id = ?')
          .get(copiedAnnotation.id),
      ).toEqual({ annotation_id: copiedAnnotation.id });

      await service.deletePermanently(sessionId, true);
      expect(await service.getDetail(clonedSession.id)).not.toBeNull();
    });

    it('rejects a fork point from another session without copying records', async () => {
      const { sessionId } = insertSession(db);
      const { documentId: otherDocumentId } = insertSession(db);

      await expect(
        service.forkAsIndependentSession({ sessionId, documentId: otherDocumentId }),
      ).rejects.toThrow(/INVALID_OWNERSHIP/);
      expect(sessionRowCount(db)).toBe(2);
    });

    it('rejects forks from an archived source session', async () => {
      const { sessionId, documentId } = insertSession(db, { status: 'archived' });

      await expect(
        service.forkAsIndependentSession({ sessionId, documentId }),
      ).rejects.toThrow(/SESSION_ARCHIVED/);
    });

    it('rolls back all copied records when cloning a document fails', async () => {
      const { sessionId, documentId } = insertSession(db);
      db.db.exec(`
        CREATE TRIGGER fail_cloned_document
        BEFORE INSERT ON analysis_documents
        WHEN NEW.session_id <> '${sessionId}'
        BEGIN
          SELECT RAISE(ABORT, 'clone insertion rejected');
        END;
      `);

      await expect(
        service.forkAsIndependentSession({ sessionId, documentId }),
      ).rejects.toThrow('clone insertion rejected');
      expect(sessionRowCount(db)).toBe(1);
    });
  });


  describe('deletePermanently', () => {
    it('deletes session and enqueues file cleanup in one transaction', async () => {
      const { sessionId, documentId } = insertSession(db);

      const result = await service.deletePermanently(sessionId, true);
      // cleanup returns { processed: 0, pending: 0 } so cleanupPending is false
      expect(result.cleanupPending).toBe(false);

      // Session should be gone
      expect(sessionRowCount(db)).toBe(0);

      // Cleanup queue should have the document path
      expect(cleanupQueueCount(db)).toBe(1);
      const queueRow = db.db
        .prepare('SELECT relative_path, document_id FROM analysis_file_cleanup_queue')
        .get() as { relative_path: string; document_id: string };
      expect(queueRow.relative_path).toBe(`generated-documents/${documentId}`);
      expect(queueRow.document_id).toBe(documentId);
    });

    it('requires confirmed=true', async () => {
      const { sessionId } = insertSession(db);
      await expect(service.deletePermanently(sessionId, false)).rejects.toThrow(
        /DELETE_CONFIRMATION_REQUIRED/,
      );
      // Session should still exist
      expect(sessionRowCount(db)).toBe(1);
    });

    it('rejects delete of nonexistent session', async () => {
      await expect(service.deletePermanently('nonexistent', true)).rejects.toThrow(
        /SESSION_NOT_FOUND/,
      );
    });

    it('allows delete of archived session', async () => {
      const { sessionId } = insertSession(db, { status: 'archived' });
      // Archived sessions can be deleted (per spec: archived menu offers "永久删除")
      const result = await service.deletePermanently(sessionId, true);
      expect(result.cleanupPending).toBe(false);
      expect(sessionRowCount(db)).toBe(0);
    });

    it('cascade deletes branches, documents, annotations, and traces', async () => {
      const { sessionId, branchId, documentId } = insertSession(db);

      // Add annotation
      const annotationId = randomUUID();
      const now = new Date().toISOString();
      db.db
        .prepare(
          `INSERT INTO analysis_annotations
             (id, analysis_document_id, anchor_start_offset, anchor_end_offset,
              anchor_exact_text, selected_text, anchor_prefix, anchor_suffix,
              question, status, created_at, updated_at)
           VALUES (?, ?, 0, 4, 'test', 'test', '', '', 'question', 'pending', ?, ?)`,
        )
        .run(annotationId, documentId, now, now);

      // Add tool trace
      const traceId = randomUUID();
      db.db
        .prepare(
          `INSERT INTO analysis_tool_traces
             (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
           VALUES (?, ?, 0, 'test', '{}', 'summary', ?)`,
        )
        .run(traceId, documentId, now);

      await service.deletePermanently(sessionId, true);

      expect(sessionRowCount(db)).toBe(0);
      expect(
        (db.db.prepare('SELECT COUNT(*) AS count FROM analysis_branches').get() as any).count,
      ).toBe(0);
      expect(
        (db.db.prepare('SELECT COUNT(*) AS count FROM analysis_documents').get() as any).count,
      ).toBe(0);
      expect(
        (db.db.prepare('SELECT COUNT(*) AS count FROM analysis_annotations').get() as any).count,
      ).toBe(0);
      expect(
        (db.db.prepare('SELECT COUNT(*) AS count FROM analysis_tool_traces').get() as any).count,
      ).toBe(0);
    });

    it('deletes a legacy session with a forked branch', async () => {
      const { sessionId, branchId: mainBranchId, documentId: rootDocumentId } = insertSession(db);
      const mainChildId = insertDocument(db, sessionId, mainBranchId, {
        parentDocumentId: rootDocumentId,
        goal: 'Main child',
      });
      db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(mainChildId, mainBranchId);

      const forkBranchId = randomUUID();
      const forkDocumentId = randomUUID();
      const now = new Date().toISOString();
      db.db
        .prepare(
          `INSERT INTO analysis_branches
             (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(forkBranchId, sessionId, 'Fork', mainBranchId, rootDocumentId, now, now);
      db.db
        .prepare(
          `INSERT INTO analysis_documents
             (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, '', 'completed', 0, ?, ?)`,
        )
        .run(forkDocumentId, sessionId, forkBranchId, rootDocumentId, 'Fork child', now, now);
      db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ? WHERE id = ?')
        .run(forkDocumentId, forkBranchId);

      await expect(service.deletePermanently(sessionId, true)).resolves.toEqual({
        cleanupPending: false,
      });
      expect(sessionRowCount(db)).toBe(0);
    });

    it('enqueues cleanup for multiple turns', async () => {
      const { sessionId, branchId, documentId: firstTurn } = insertSession(db);
      const secondTurn = insertDocument(db, sessionId, branchId, {
        parentDocumentId: firstTurn,
        goal: 'Second',
      });

      await service.deletePermanently(sessionId, true);

      expect(cleanupQueueCount(db)).toBe(2);
      const paths = db.db
        .prepare('SELECT relative_path FROM analysis_file_cleanup_queue ORDER BY relative_path')
        .all() as Array<{ relative_path: string }>;
      expect(paths.map((p) => p.relative_path)).toEqual(
        expect.arrayContaining([
          `generated-documents/${firstTurn}`,
          `generated-documents/${secondTurn}`,
        ]),
      );
    });

    it('calls cleanup.processPending after commit', async () => {
      const { sessionId } = insertSession(db);
      mockCleanup.processPending.mockResolvedValue({ processed: 1, pending: 0 });

      await service.deletePermanently(sessionId, true);

      expect(mockCleanup.processPending).toHaveBeenCalledTimes(1);
    });

    it('keeps cleanup pending when no cleanup processor is configured', async () => {
      const { sessionId } = insertSession(db);
      const serviceWithoutCleanup = new AnalysisSessionService(db);

      await expect(serviceWithoutCleanup.deletePermanently(sessionId, true)).resolves.toEqual({
        cleanupPending: true,
      });
    });

    it('rolls back the session deletion when cleanup queue insertion fails', async () => {
      const { sessionId, documentId } = insertSession(db);
      const now = new Date().toISOString();
      db.db
        .prepare(
          `INSERT INTO analysis_file_cleanup_queue
             (id, document_id, relative_path, attempts, last_error, created_at, updated_at)
           VALUES (?, ?, ?, 0, NULL, ?, ?)`,
        )
        .run(`cleanup-${documentId}`, documentId, 'existing-path', now, now);

      await expect(service.deletePermanently(sessionId, true)).rejects.toThrow();
      expect(sessionRowCount(db)).toBe(1);
    });
  });
});
