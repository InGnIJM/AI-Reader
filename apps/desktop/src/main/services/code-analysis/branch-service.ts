import type { DatabaseClient } from '../../db/client';
import type {
  AnalysisBranch,
  AnalysisTurn,
  CodeAnalysisCheckoutTurnPayload,
  CodeAnalysisSwitchBranchPayload,
} from '@ai-reader/shared';

const NAME_MIN_LENGTH = 1;
const NAME_MAX_LENGTH = 80;

export class AnalysisBranchService {
  constructor(private readonly db: DatabaseClient) {}

  async list(sessionId: string): Promise<AnalysisBranch[]> {
    return this.db.db
      .prepare(
        `SELECT id, session_id AS sessionId, name,
                parent_branch_id AS parentBranchId,
                forked_from_document_id AS forkedFromDocumentId,
                head_document_id AS headDocumentId,
                created_at AS createdAt, updated_at AS updatedAt
         FROM analysis_branches
         WHERE session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as AnalysisBranch[];
  }

  async resolvePath(sessionId: string, branchId: string): Promise<AnalysisTurn[]> {
    const branch = this.getBranchOrThrow(sessionId, branchId);
    if (!branch.headDocumentId) return [];

    // Walk from head to root via parent_document_id
    const chain: AnalysisTurn[] = [];
    let currentId: string | null = branch.headDocumentId;

    while (currentId) {
      const turn = this.db.db
        .prepare(
          `SELECT id, session_id AS sessionId, branch_id AS branchId,
                  parent_document_id AS parentDocumentId,
                  goal, content_markdown AS contentMarkdown,
                  status, model_id AS modelId,
                  tool_call_count AS toolCallCount,
                  created_at AS createdAt, updated_at AS updatedAt
           FROM analysis_documents WHERE id = ?`,
        )
        .get(currentId) as AnalysisTurn | undefined;

      if (!turn) break;
      chain.push(turn);
      currentId = turn.parentDocumentId ?? null;
    }

    // Reverse to get root-to-head order
    chain.reverse();
    return chain;
  }

  async checkout(payload: CodeAnalysisCheckoutTurnPayload): Promise<void> {
    const { sessionId, branchId, documentId } = payload;

    // Verify branch belongs to session
    this.getBranchOrThrow(sessionId, branchId);

    // Verify document belongs to the branch path
    const path = await this.resolvePath(sessionId, branchId);
    if (!path.some((t) => t.id === documentId)) {
      throw new BranchServiceError(
        'INVALID_OWNERSHIP',
        'Document is not in the requested branch path',
      );
    }

    const now = new Date().toISOString();
    this.db.db
      .prepare(
        'UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(branchId, documentId, now, sessionId);
  }

  async switchBranch(payload: CodeAnalysisSwitchBranchPayload): Promise<void> {
    const { sessionId, branchId } = payload;
    const branch = this.getBranchOrThrow(sessionId, branchId);

    const now = new Date().toISOString();
    this.db.db
      .prepare(
        'UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(branchId, branch.headDocumentId ?? null, now, sessionId);
  }

  async rename(sessionId: string, branchId: string, name: string): Promise<AnalysisBranch> {
    this.getBranchOrThrow(sessionId, branchId);

    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN_LENGTH) {
      throw new BranchServiceError('INVALID_TITLE', 'Branch name must not be empty');
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      throw new BranchServiceError(
        'INVALID_TITLE',
        `Branch name must not exceed ${NAME_MAX_LENGTH} characters`,
      );
    }

    const now = new Date().toISOString();
    this.db.db
      .prepare('UPDATE analysis_branches SET name = ?, updated_at = ? WHERE id = ?')
      .run(trimmed, now, branchId);

    return this.getBranchOrThrow(sessionId, branchId);
  }

  async decideWrite(
    sessionId: string,
    parentDocumentId: string,
    forceFork?: boolean,
  ): Promise<{ action: 'append' | 'fork'; branchId: string }> {
    // Find the branch that contains this document as head
    const session = this.db.db
      .prepare('SELECT active_branch_id FROM analysis_sessions WHERE id = ?')
      .get(sessionId) as { active_branch_id: string } | undefined;

    if (!session) {
      throw new BranchServiceError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
    }

    const activeBranchId = session.active_branch_id;
    const branch = this.db.db
      .prepare('SELECT head_document_id FROM analysis_branches WHERE id = ?')
      .get(activeBranchId) as { head_document_id: string | null } | undefined;

    if (!branch) {
      throw new BranchServiceError('BRANCH_NOT_FOUND', `Branch not found: ${activeBranchId}`);
    }

    const isHead = branch.head_document_id === parentDocumentId;

    if (forceFork || !isHead) {
      return { action: 'fork', branchId: activeBranchId };
    }

    return { action: 'append', branchId: activeBranchId };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getBranchOrThrow(sessionId: string, branchId: string): AnalysisBranch {
    const row = this.db.db
      .prepare(
        `SELECT id, session_id AS sessionId, name,
                parent_branch_id AS parentBranchId,
                forked_from_document_id AS forkedFromDocumentId,
                head_document_id AS headDocumentId,
                created_at AS createdAt, updated_at AS updatedAt
         FROM analysis_branches WHERE id = ? AND session_id = ?`,
      )
      .get(branchId, sessionId) as AnalysisBranch | undefined;

    if (!row) {
      throw new BranchServiceError(
        'BRANCH_NOT_FOUND',
        `Branch not found: ${branchId} in session ${sessionId}`,
      );
    }
    return row;
  }
}

export class BranchServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'BranchServiceError';
  }
}
