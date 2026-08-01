import { randomUUID } from 'crypto';
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

interface StoredAnalysisDocument {
  id: string;
  parent_document_id: string | null;
  goal: string;
  content_markdown: string;
  status: AnalysisTurn['status'];
  model_id: string | null;
  tool_call_count: number;
  created_at: string;
  updated_at: string;
}

interface StoredToolTrace {
  id: string;
  analysis_document_id: string;
  step_index: number;
  tool_name: string;
  tool_args_json: string;
  result_summary: string;
  created_at: string;
}

interface StoredAnnotation {
  id: string;
  analysis_document_id: string;
  anchor_start_offset: number;
  anchor_end_offset: number;
  anchor_exact_text: string;
  selected_text: string;
  anchor_prefix: string;
  anchor_suffix: string;
  question: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface StoredDiscussionMessage {
  id: string;
  annotation_id: string;
  role: string;
  content: string;
  model_id: string | null;
  created_at: string;
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

  async forkAsIndependentSession(input: {
    sessionId: string;
    documentId: string;
  }): Promise<AnalysisSession> {
    const sourceSession = this.getSessionOrThrow(input.sessionId);
    if (sourceSession.status !== 'active') {
      throw new SessionServiceError('SESSION_ARCHIVED', 'Cannot fork an archived session');
    }

    const sourceDocuments = this.getDocumentPath(input.sessionId, input.documentId);
    const now = new Date().toISOString();
    const clonedSessionId = randomUUID();
    const clonedBranchId = randomUUID();
    const documentIdMap = new Map<string, string>();
    const annotationIdMap = new Map<string, string>();

    const insertSession = this.db.db.prepare(`
      INSERT INTO analysis_sessions
        (id, project_id, title, status, active_branch_id, active_document_id,
         archived_at, created_at, updated_at)
      VALUES (?, ?, ?, 'active', NULL, NULL, NULL, ?, ?)
    `);
    const insertBranch = this.db.db.prepare(`
      INSERT INTO analysis_branches
        (id, session_id, name, parent_branch_id, forked_from_document_id,
         head_document_id, created_at, updated_at)
      VALUES (?, ?, 'Main', NULL, NULL, NULL, ?, ?)
    `);
    const insertDocument = this.db.db.prepare(`
      INSERT INTO analysis_documents
        (id, session_id, branch_id, parent_document_id, goal, content_markdown,
         status, model_id, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertToolTrace = this.db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json,
         result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAnnotation = this.db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset,
         anchor_exact_text, selected_text, anchor_prefix, anchor_suffix,
         question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMessage = this.db.db.prepare(`
      INSERT INTO analysis_discussion_messages
        (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.db.db.exec('BEGIN IMMEDIATE');
    try {
      insertSession.run(
        clonedSessionId,
        sourceSession.projectId,
        `${sourceSession.title} · Branch`,
        now,
        now,
      );
      insertBranch.run(clonedBranchId, clonedSessionId, now, now);

      for (const sourceDocument of sourceDocuments) {
        const clonedDocumentId = randomUUID();
        documentIdMap.set(sourceDocument.id, clonedDocumentId);
        const clonedParentId = sourceDocument.parent_document_id
          ? documentIdMap.get(sourceDocument.parent_document_id)
          : null;
        if (sourceDocument.parent_document_id && !clonedParentId) {
          throw new SessionServiceError(
            'INVALID_OWNERSHIP',
            'Fork point has an invalid parent document path',
          );
        }
        insertDocument.run(
          clonedDocumentId,
          clonedSessionId,
          clonedBranchId,
          clonedParentId,
          sourceDocument.goal,
          sourceDocument.content_markdown,
          sourceDocument.status,
          sourceDocument.model_id,
          sourceDocument.tool_call_count,
          sourceDocument.created_at,
          sourceDocument.updated_at,
        );
      }

      for (const sourceDocument of sourceDocuments) {
        const clonedDocumentId = documentIdMap.get(sourceDocument.id)!;
        const traces = this.db.db
          .prepare(
            `SELECT id, analysis_document_id, step_index, tool_name, tool_args_json,
                    result_summary, created_at
             FROM analysis_tool_traces
             WHERE analysis_document_id = ?
             ORDER BY step_index ASC, created_at ASC`,
          )
          .all(sourceDocument.id) as StoredToolTrace[];
        for (const trace of traces) {
          insertToolTrace.run(
            randomUUID(),
            clonedDocumentId,
            trace.step_index,
            trace.tool_name,
            trace.tool_args_json,
            trace.result_summary,
            trace.created_at,
          );
        }

        const annotations = this.db.db
          .prepare(
            `SELECT id, analysis_document_id, anchor_start_offset, anchor_end_offset,
                    anchor_exact_text, selected_text, anchor_prefix, anchor_suffix,
                    question, status, created_at, updated_at
             FROM analysis_annotations
             WHERE analysis_document_id = ?
             ORDER BY created_at ASC`,
          )
          .all(sourceDocument.id) as StoredAnnotation[];
        for (const annotation of annotations) {
          const clonedAnnotationId = randomUUID();
          annotationIdMap.set(annotation.id, clonedAnnotationId);
          insertAnnotation.run(
            clonedAnnotationId,
            clonedDocumentId,
            annotation.anchor_start_offset,
            annotation.anchor_end_offset,
            annotation.anchor_exact_text,
            annotation.selected_text,
            annotation.anchor_prefix,
            annotation.anchor_suffix,
            annotation.question,
            annotation.status,
            annotation.created_at,
            annotation.updated_at,
          );
        }
      }

      for (const [sourceAnnotationId, clonedAnnotationId] of annotationIdMap) {
        const messages = this.db.db
          .prepare(
            `SELECT id, annotation_id, role, content, model_id, created_at
             FROM analysis_discussion_messages
             WHERE annotation_id = ?
             ORDER BY created_at ASC`,
          )
          .all(sourceAnnotationId) as StoredDiscussionMessage[];
        for (const message of messages) {
          insertMessage.run(
            randomUUID(),
            clonedAnnotationId,
            message.role,
            message.content,
            message.model_id,
            message.created_at,
          );
        }
      }

      const clonedForkDocumentId = documentIdMap.get(input.documentId)!;
      this.db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ?, updated_at = ? WHERE id = ?')
        .run(clonedForkDocumentId, now, clonedBranchId);
      this.db.db
        .prepare(
          'UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(clonedBranchId, clonedForkDocumentId, now, clonedSessionId);
      this.db.db.exec('COMMIT');
    } catch (error) {
      if (this.db.db.inTransaction) this.db.db.exec('ROLLBACK');
      throw error;
    }

    return this.getSessionOrThrow(clonedSessionId);
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

  private getDocumentPath(sessionId: string, documentId: string): StoredAnalysisDocument[] {
    const selectDocument = this.db.db.prepare(`
      SELECT id, parent_document_id, goal, content_markdown, status, model_id,
             tool_call_count, created_at, updated_at
      FROM analysis_documents
      WHERE id = ? AND session_id = ?
    `);
    const path: StoredAnalysisDocument[] = [];
    let currentDocumentId: string | null = documentId;

    while (currentDocumentId) {
      const document = selectDocument.get(currentDocumentId, sessionId) as
        | StoredAnalysisDocument
        | undefined;
      if (!document) {
        throw new SessionServiceError(
          'INVALID_OWNERSHIP',
          'Fork point does not belong to the requested session',
        );
      }
      path.push(document);
      currentDocumentId = document.parent_document_id;
    }

    return path.reverse();
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
