import { useState, useCallback } from 'react';
import type { AnalysisTurn, AnalysisBranch } from '@ai-reader/shared';
import styles from './CodeAnalysisComponents.module.css';

// ── i18n ─────────────────────────────────────────────────────────────────────

const i18n = {
  'zh-CN': {
    branch: '分支',
    noTurns: '暂无对话轮次。',
    checkout: '回退',
    branchFromHere: '创建分支',
    renameBranch: '重命名分支',
    tools: (n: number) => `${n} 工具`,
  },
  'en-US': {
    branch: 'Branch',
    noTurns: 'No conversation turns yet.',
    checkout: 'Checkout',
    branchFromHere: 'Branch from here',
    renameBranch: 'Rename branch',
    tools: (n: number) => (n === 1 ? '1 tool' : `${n} tools`),
  },
} as const;

type Language = 'zh-CN' | 'en-US';

// ── Props ────────────────────────────────────────────────────────────────────

export interface ConversationTimelineProps {
  turns: AnalysisTurn[];
  activeTurnId?: string;
  activeBranchId?: string;
  branches?: AnalysisBranch[];
  onSelectTurn?: (turn: AnalysisTurn) => void;
  onCheckoutTurn?: (sessionId: string, branchId: string, documentId: string) => void;
  onForkFromTurn?: (documentId: string) => void;
  forkDisabled?: boolean;
  onSwitchBranch?: (sessionId: string, branchId: string) => void;
  onRenameBranch?: (sessionId: string, branchId: string, name: string) => void;
  language?: Language;
}

// ── Status Icons ─────────────────────────────────────────────────────────────

function statusIcon(status: AnalysisTurn['status']): string {
  switch (status) {
    case 'completed':
      return 'check_circle';
    case 'running':
      return 'progress_activity';
    case 'failed':
      return 'error';
    case 'pending':
      return 'schedule';
    default:
      return 'radio_button_unchecked';
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConversationTimeline({
  turns,
  activeTurnId,
  activeBranchId,
  branches,
  onSelectTurn,
  onCheckoutTurn,
  onForkFromTurn,
  forkDisabled = false,
  onSwitchBranch,
  onRenameBranch,
  language = 'zh-CN',
}: ConversationTimelineProps) {
  const t = i18n[language];
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const showBranchSwitcher = branches && branches.length > 1;
  const sessionId = turns[0]?.sessionId ?? '';

  const handleSelectTurn = useCallback(
    (turn: AnalysisTurn) => {
      onSelectTurn?.(turn);
    },
    [onSelectTurn],
  );

  const handleCheckout = useCallback(
    (turn: AnalysisTurn) => {
      onCheckoutTurn?.(sessionId, turn.branchId, turn.parentDocumentId ?? turn.id);
    },
    [onCheckoutTurn, sessionId],
  );

  const handleForkFromTurn = useCallback(
    (turn: AnalysisTurn) => {
      onForkFromTurn?.(turn.id);
    },
    [onForkFromTurn],
  );

  const handleBranchSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onSwitchBranch?.(sessionId, e.target.value);
    },
    [onSwitchBranch, sessionId],
  );

  const startRename = useCallback(() => {
    if (!activeBranchId) return;
    const currentBranch = branches?.find((b) => b.id === activeBranchId);
    setRenamingBranch(activeBranchId);
    setRenameValue(currentBranch?.name ?? '');
  }, [activeBranchId, branches]);

  const commitRename = useCallback(() => {
    if (!renamingBranch || !renameValue.trim()) return;
    onRenameBranch?.(sessionId, renamingBranch, renameValue.trim());
    setRenamingBranch(null);
    setRenameValue('');
  }, [onRenameBranch, sessionId, renamingBranch, renameValue]);

  const cancelRename = useCallback(() => {
    setRenamingBranch(null);
    setRenameValue('');
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitRename();
      } else if (e.key === 'Escape') {
        cancelRename();
      }
    },
    [commitRename, cancelRename],
  );

  // ── Empty state ──────────────────────────────────────────────────────────

  if (turns.length === 0) {
    return (
      <div className={styles.traceList} aria-label="Conversation timeline">
        <p className={styles.muted}>{t.noTurns}</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const lastIndex = turns.length - 1;

  return (
    <div className={styles.timelineRoot} aria-label="Conversation timeline">
      {/* Branch switcher */}
      {showBranchSwitcher && (
        <div className={styles.timelineBranchBar}>
          <label className={styles.timelineBranchLabel}>
            <span className="material-symbols-rounded" aria-hidden="true">
              fork_right
            </span>
            {t.branch}
            <select
              className={styles.timelineBranchSelect}
              value={activeBranchId ?? branches![0].id}
              onChange={handleBranchSelect}
              aria-label={t.branch}
            >
              {branches!.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          {/* Rename button / inline input */}
          {onRenameBranch && activeBranchId && (
            <>
              {renamingBranch === activeBranchId ? (
                <input
                  className={styles.timelineRenameInput}
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  aria-label={t.branch + ' name'}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className={styles.timelineRenameBtn}
                  onClick={startRename}
                  aria-label={t.renameBranch}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    edit
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Turn list */}
      <ul className={styles.timelineList} role="list">
        {turns.map((turn, index) => {
          const isActive = turn.id === activeTurnId;
          const isLast = index === lastIndex;

          return (
            <li
              key={turn.id}
              className={styles.timelineItem}
              data-active={isActive ? 'true' : undefined}
              role="listitem"
            >
              {/* Status icon */}
              <span
                className={`material-symbols-rounded ${styles.timelineStatusIcon}`}
                aria-hidden="true"
              >
                {statusIcon(turn.status)}
              </span>

              {/* Turn content */}
              <div className={styles.timelineContent}>
                <button
                  type="button"
                  className={styles.timelineGoalBtn}
                  onClick={() => handleSelectTurn(turn)}
                >
                  {turn.goal}
                </button>

                {/* Tool count */}
                {turn.toolCallCount > 0 && (
                  <span className={styles.timelineToolCount}>
                    {t.tools(turn.toolCallCount)}
                  </span>
                )}
              </div>

              {/* Checkout only applies to history; an independent session can start at any turn. */}
              {((!isLast && onCheckoutTurn) || onForkFromTurn) && (
                <div className={styles.timelineActions}>
                  {!isLast && onCheckoutTurn && (
                    <button
                      type="button"
                      className={styles.timelineActionBtn}
                      onClick={() => handleCheckout(turn)}
                      aria-label={t.checkout}
                      title={t.checkout}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        history
                      </span>
                      <span>{t.checkout}</span>
                    </button>
                  )}
                  {onForkFromTurn && (
                    <button
                      type="button"
                      className={styles.timelineActionBtn}
                      onClick={() => handleForkFromTurn(turn)}
                      disabled={forkDisabled}
                      aria-label={t.branchFromHere}
                      title={t.branchFromHere}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        fork_right
                      </span>
                      <span>{t.branchFromHere}</span>
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
