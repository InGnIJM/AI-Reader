import { describe, expect, expectTypeOf, it } from 'vitest';

import { IPC_CHANNELS } from '../channels';
import type {
  AnalysisBranch,
  AnalysisSession,
  AnalysisSessionDetail,
  AnalysisSessionStatus,
  AnalysisTurn,
  CodeAnalysisAnnotationCreatePayload,
  CodeAnalysisAnnotationData,
  CodeAnalysisCheckoutTurnPayload,
  CodeAnalysisDeleteSessionPayload,
  CodeAnalysisForkSessionPayload,
  CodeAnalysisListRecentSessionsPayload,
  CodeAnalysisListSessionsPayload,
  CodeAnalysisRenameBranchPayload,
  CodeAnalysisRenameSessionPayload,
  CodeAnalysisRunTurnPayload,
  CodeAnalysisRunTurnResult,
  CodeAnalysisSourceAnnotationCreatePayload,
  CodeAnalysisSwitchBranchPayload,
} from '../../index';

const session: AnalysisSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: 'Understand the workspace',
  status: 'active',
  activeBranchId: 'branch-1',
  activeDocumentId: 'turn-1',
  archivedAt: null,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const branch: AnalysisBranch = {
  id: 'branch-1',
  sessionId: session.id,
  name: 'Main',
  parentBranchId: null,
  forkedFromDocumentId: null,
  headDocumentId: 'turn-1',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const turn: AnalysisTurn = {
  id: 'turn-1',
  sessionId: session.id,
  branchId: branch.id,
  parentDocumentId: null,
  goal: 'Explain this repository',
  contentMarkdown: '# Repository',
  status: 'completed',
  modelId: 'test-model',
  toolCallCount: 3,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('code analysis session contracts', () => {
  it('models sessions, branches, turns, and session details', () => {
    const detail: AnalysisSessionDetail = {
      session,
      branches: [branch],
      turns: [turn],
    };

    expect(detail.session.activeDocumentId).toBe(turn.id);
    expect(detail.branches[0]?.headDocumentId).toBe(turn.id);
    expect(detail.turns[0]?.parentDocumentId).toBeNull();
    expectTypeOf<AnalysisSessionStatus>().toEqualTypeOf<'active' | 'archived'>();
  });

  it('models first, continued, and forced-fork turn requests', () => {
    const firstTurn: CodeAnalysisRunTurnPayload = {
      projectId: null,
      goal: 'Create a local document',
    };
    const continuedTurn: CodeAnalysisRunTurnPayload = {
      sessionId: session.id,
      goal: 'Continue the explanation',
    };
    const forcedFork: CodeAnalysisRunTurnPayload = {
      sessionId: session.id,
      parentDocumentId: turn.id,
      goal: 'Explore another approach',
      forceFork: true,
    };
    const result: CodeAnalysisRunTurnResult = { session, branch, turn };

    expect(firstTurn.projectId).toBeNull();
    expect(continuedTurn.sessionId).toBe(session.id);
    expect(forcedFork.forceFork).toBe(true);
    expect(result.turn.id).toBe(turn.id);
  });

  it('models checkout and session management requests', () => {
    const checkout: CodeAnalysisCheckoutTurnPayload = {
      sessionId: session.id,
      branchId: branch.id,
      documentId: turn.id,
    };
    const list: CodeAnalysisListSessionsPayload = {
      projectId: session.projectId,
      status: 'active',
      limit: 20,
    };
    const recent: CodeAnalysisListRecentSessionsPayload = { limit: 10 };
    const renameSession: CodeAnalysisRenameSessionPayload = {
      sessionId: session.id,
      title: 'Renamed session',
    };
    const deleteSession: CodeAnalysisDeleteSessionPayload = {
      sessionId: session.id,
      confirmed: true,
    };
    const forkSession: CodeAnalysisForkSessionPayload = {
      sessionId: session.id,
      documentId: turn.id,
    };
    const switchBranch: CodeAnalysisSwitchBranchPayload = {
      sessionId: session.id,
      branchId: branch.id,
    };
    const renameBranch: CodeAnalysisRenameBranchPayload = {
      ...switchBranch,
      name: 'Alternative',
    };

    expect(checkout.documentId).toBe(turn.id);
    expect(list.status).toBe('active');
    expect(recent.limit).toBe(10);
    expect(renameSession.title).toBe('Renamed session');
    expect(deleteSession.confirmed).toBe(true);
    expect(forkSession.documentId).toBe(turn.id);
    expect(renameBranch.name).toBe('Alternative');
  });

  it('adds source offsets without removing the legacy annotation request', () => {
    const legacy: CodeAnalysisAnnotationCreatePayload = {
      analysisDocumentId: turn.id,
      selectedText: 'Repository',
      question: 'What does this mean?',
    };
    const sourceMapped: CodeAnalysisAnnotationCreatePayload = {
      analysisDocumentId: turn.id,
      selectedText: 'Repository',
      question: 'What does this mean?',
      sourceStartOffset: 2,
      sourceEndOffset: 12,
    };
    const sourceContract: CodeAnalysisSourceAnnotationCreatePayload = sourceMapped;
    const annotation: CodeAnalysisAnnotationData = {
      id: 'annotation-1',
      analysisDocumentId: turn.id,
      selectedText: 'Repository',
      anchorStartOffset: 2,
      anchorEndOffset: 12,
      anchorExactText: 'Repository',
      anchorPrefix: '# ',
      anchorSuffix: '',
      question: 'What does this mean?',
      status: 'pending',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };

    expect(sourceContract.sourceEndOffset).toBeGreaterThan(
      sourceContract.sourceStartOffset,
    );
    expect(legacy.selectedText).toBe('Repository');
    expect(annotation.selectedText).toBe('Repository');
  });

  it('defines every session, turn, and branch IPC channel', () => {
    expect({
      listSessions: IPC_CHANNELS.CODE_ANALYSIS_LIST_SESSIONS,
      listRecentSessions: IPC_CHANNELS.CODE_ANALYSIS_LIST_RECENT_SESSIONS,
      getSession: IPC_CHANNELS.CODE_ANALYSIS_GET_SESSION,
      renameSession: IPC_CHANNELS.CODE_ANALYSIS_RENAME_SESSION,
      archiveSession: IPC_CHANNELS.CODE_ANALYSIS_ARCHIVE_SESSION,
      restoreSession: IPC_CHANNELS.CODE_ANALYSIS_RESTORE_SESSION,
      deleteSession: IPC_CHANNELS.CODE_ANALYSIS_DELETE_SESSION,
      forkSession: IPC_CHANNELS.CODE_ANALYSIS_FORK_SESSION,
      forkActiveSession: IPC_CHANNELS.CODE_ANALYSIS_FORK_ACTIVE_SESSION,
      exportSession: IPC_CHANNELS.CODE_ANALYSIS_EXPORT_SESSION,
      runTurn: IPC_CHANNELS.CODE_ANALYSIS_RUN_TURN,
      checkoutTurn: IPC_CHANNELS.CODE_ANALYSIS_CHECKOUT_TURN,
      listBranches: IPC_CHANNELS.CODE_ANALYSIS_LIST_BRANCHES,
      switchBranch: IPC_CHANNELS.CODE_ANALYSIS_SWITCH_BRANCH,
      renameBranch: IPC_CHANNELS.CODE_ANALYSIS_RENAME_BRANCH,
    }).toEqual({
      listSessions: 'codeAnalysis:listSessions',
      listRecentSessions: 'codeAnalysis:listRecentSessions',
      getSession: 'codeAnalysis:getSession',
      renameSession: 'codeAnalysis:renameSession',
      archiveSession: 'codeAnalysis:archiveSession',
      restoreSession: 'codeAnalysis:restoreSession',
      deleteSession: 'codeAnalysis:deleteSession',
      forkSession: 'codeAnalysis:forkSession',
      forkActiveSession: 'codeAnalysis:forkActiveSession',
      exportSession: 'codeAnalysis:exportSession',
      runTurn: 'codeAnalysis:runTurn',
      checkoutTurn: 'codeAnalysis:checkoutTurn',
      listBranches: 'codeAnalysis:listBranches',
      switchBranch: 'codeAnalysis:switchBranch',
      renameBranch: 'codeAnalysis:renameBranch',
    });
  });
});
