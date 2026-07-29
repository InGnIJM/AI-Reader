import type { DatabaseClient } from '../../db/client';
import type {
  AnalysisBranch,
  AnalysisSession,
  AnalysisSessionDetail,
  AnalysisSessionStatus,
  AnalysisTurn,
} from '@ai-reader/shared';

const TITLE_MIN_LENGTH = 1;
const TITLE_MAX_LENGTH = 80;
const DEFAULT_RECENT_LIMIT = 20;
const MAX_RECENT_LIMIT = 100;

interface CleanupProcessor {
  processPending(): Promise<{ processed: number; pending: number }>;
}

export class AnalysisSessionService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly cleanup?: CleanupProcessor,
  ) {}

  async listByProject(
    projectId: string | null,
    status: AnalysisSessionStatus,
  ): Promise<AnalysisSession[]> {
    const whereClause = projectId === null ? 'project_id IS NULL' : 'project_id = ?';
    const statement = this.db.db.prepare(`
      SELECT id, project_id AS projectId, title, status,
             active_branch_id AS activeBranchId,
             active_document_id AS activeDocumentId,
             archived_at AS archivedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_sessions
      WHERE ${whereClause} AND status = ?
      ORDER BY updated_at DESC
    `);
    return (projectId === null
      ? statement.all(status)
      : statement.all(projectId, status)) as AnalysisSession[];
  }

  async listRecent(input: {
    status: AnalysisSessionStatus;
    limit?: number;
  }): Promise<AnalysisSession[]> {
    const limit = clampLimit(input.limit ?? DEFAULT_RECENT_LIMIT);
    return this.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, title, status,
             active_branch_id AS activeBranchId,
             active_document_id AS activeDocumentId,
             archived_at AS archivedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_sessions
      WHERE status = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      )
      .all(input.status, limit) as AnalysisSession[];
  }

  async getDetail(sessionId: string): Promise<AnalysisSessionDetail | null> {
    const session = this.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, title, status,
             active_branch_id AS activeBranchId,
             active_document_id AS activeDocumentId,
             archived_at AS archivedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_sessions WHERE id = ?
    `,
      )
      .get(sessionId) as AnalysisSession | undefined;
    if (!session) return null;

    const branches = this.db.db
      .prepare(
        `
      SELECT id, session_id AS sessionId, name,
             parent_branch_id AS parentBranchId,
             forked_from_document_id AS forkedFromDocumentId,
             head_document_id AS headDocumentId,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_branches
      WHERE session_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(sessionId) as AnalysisBranch[];

    const turns = this.db.db
      .prepare(
        `
      SELECT id, session_id AS sessionId, branch_id AS branchId,
             parent_document_id AS parentDocumentId,
             goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId,
             tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents
      WHERE session_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(sessionId) as AnalysisTurn[];

    return { session, branches, turns };
  }

  async rename(sessionId: string, title: string): Promise<AnalysisSession> {
    const existing = this.getSessionOrThrow(sessionId);
    const trimmed = title.trim();
    if (trimmed.length < TITLE_MIN_LENGTH) {
      throw new SessionServiceError('INVALID_TITLE', 'Title must not be empty');
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      throw new SessionServiceError(
        'INVALID_TITLE',
        `Title must not exceed ${TITLE_MAX_LENGTH} characters`,
      );
    }

    const now = new Date().toISOString();
    this.db.db
      .prepare('UPDATE analysis_sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(trimmed, now, sessionId);

    return this.getSessionOrThrow(sessionId);
  }

  async archive(sessionId: string): Promise<AnalysisSession> {
    const existing = this.getSessionOrThrow(sessionId);
    if (existing.status === 'archived') {
      throw new SessionServiceError('SESSION_ARCHIVED', 'Session is already archived');
    }

    const now = new Date().toISOString();
    this.db.db
      .prepare(
        "UPDATE analysis_sessions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, sessionId);

    return this.getSessionOrThrow(sessionId);
  }

  async restore(sessionId: string): Promise<AnalysisSession> {
    const existing = this.getSessionOrThrow(sessionId);
    if (existing.status === 'active') {
      throw new SessionServiceError('SESSION_ARCHIVED', 'Session is already active');
    }

    const now = new Date().toISOString();
    this.db.db
      .prepare(
        "UPDATE analysis_sessions SET status = 'active', archived_at = NULL, updated_at = ? WHERE id = ?",
      )
      .run(now, sessionId);

    return this.getSessionOrThrow(sessionId);
  }

  async deletePermanently(
    sessionId: string,
    confirmed: boolean,
  ): Promise<{ cleanupPending: boolean }> {
    if (!confirmed) {
      throw new SessionServiceError(
        'DELETE_CONFIRMATION_REQUIRED',
        'Permanent deletion requires confirmation',
      );
    }

    this.getSessionOrThrow(sessionId);

    // Collect all turn IDs for file cleanup enqueue
    const turns = this.db.db
      .prepare('SELECT id FROM analysis_documents WHERE session_id = ?')
      .all(sessionId) as Array<{ id: string }>;

    const now = new Date().toISOString();

    // Enqueue cleanup and delete session in one transaction
    const insertCleanup = this.db.db.prepare(`
      INSERT INTO analysis_file_cleanup_queue
        (id, document_id, relative_path, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, 0, NULL, ?, ?)
    `);
    const deleteSession = this.db.db.prepare('DELETE FROM analysis_sessions WHERE id = ?');

    this.db.db.exec('BEGIN IMMEDIATE');
    try {
      for (const turn of turns) {
        const relativePath = `generated-documents/${turn.id}`;
        insertCleanup.run(
          `cleanup-${turn.id}`,
          turn.id,
          relativePath,
          now,
          now,
        );
      }
      deleteSession.run(sessionId);
      this.db.db.exec('COMMIT');
    } catch (error) {
      this.db.db.exec('ROLLBACK');
      throw error;
    }

    // Process cleanup after commit
    let cleanupPending = false;
    if (this.cleanup) {
      const result = await this.cleanup.processPending();
      cleanupPending = result.pending > 0;
    } else {
      cleanupPending = turns.length > 0;
    }

    return { cleanupPending };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getSessionOrThrow(sessionId: string): AnalysisSession {
    const row = this.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, title, status,
             active_branch_id AS activeBranchId,
             active_document_id AS activeDocumentId,
             archived_at AS archivedAt,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_sessions WHERE id = ?
    `,
      )
      .get(sessionId) as AnalysisSession | undefined;
    if (!row) {
      throw new SessionServiceError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
    }
    return row;
  }
}

export class SessionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'SessionServiceError';
  }
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_RECENT_LIMIT);
}
