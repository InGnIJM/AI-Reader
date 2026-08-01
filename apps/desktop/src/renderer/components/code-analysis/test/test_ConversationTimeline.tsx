import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationTimeline } from '../ConversationTimeline';
import type { AnalysisTurn, AnalysisBranch } from '@ai-reader/shared';

// ── Cleanup ──────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeTurn(overrides: Partial<AnalysisTurn> = {}): AnalysisTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    branchId: 'branch-main',
    parentDocumentId: null,
    goal: 'Analyze the auth module',
    contentMarkdown: '# Auth Analysis\n\nThe auth module uses JWT tokens.',
    status: 'completed',
    toolCallCount: 3,
    createdAt: '2026-07-29T10:00:00Z',
    updatedAt: '2026-07-29T10:01:00Z',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<AnalysisBranch> = {}): AnalysisBranch {
  return {
    id: 'branch-main',
    sessionId: 'session-1',
    name: 'main',
    parentBranchId: null,
    forkedFromDocumentId: null,
    headDocumentId: 'doc-3',
    createdAt: '2026-07-29T10:00:00Z',
    updatedAt: '2026-07-29T10:01:00Z',
    ...overrides,
  };
}

const sampleTurns: AnalysisTurn[] = [
  makeTurn({ id: 'turn-1', goal: 'First question', createdAt: '2026-07-29T10:00:00Z' }),
  makeTurn({ id: 'turn-2', goal: 'Second question', createdAt: '2026-07-29T10:05:00Z' }),
  makeTurn({ id: 'turn-3', goal: 'Third question', createdAt: '2026-07-29T10:10:00Z' }),
];

const sampleBranches: AnalysisBranch[] = [
  makeBranch({ id: 'branch-main', name: 'main' }),
  makeBranch({ id: 'branch-explore', name: 'explore', parentBranchId: 'branch-main' }),
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ConversationTimeline', () => {
  // 1. 渲染 turn 列表
  it('renders a list of turns with their goals', () => {
    render(<ConversationTimeline turns={sampleTurns} />);

    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Second question')).toBeInTheDocument();
    expect(screen.getByText('Third question')).toBeInTheDocument();
  });

  it('renders empty state when no turns provided', () => {
    render(<ConversationTimeline turns={[]} language="en-US" />);
    expect(screen.getByText('No conversation turns yet.')).toBeInTheDocument();
  });

  it('renders empty state in Chinese', () => {
    render(<ConversationTimeline turns={[]} language="zh-CN" />);
    expect(screen.getByText('暂无对话轮次。')).toBeInTheDocument();
  });

  // 2. 高亮活跃 turn
  it('highlights the active turn with data-active attribute', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        activeTurnId="turn-2"
      />,
    );

    const items = screen.getAllByRole('listitem');
    // turn-2 should be active
    const activeItem = items.find((el) => el.getAttribute('data-active') === 'true');
    expect(activeItem).toBeTruthy();
    expect(within(activeItem!).getByText('Second question')).toBeInTheDocument();

    // others should not be active
    const inactiveItems = items.filter((el) => el.getAttribute('data-active') !== 'true');
    expect(inactiveItems).toHaveLength(2);
  });

  // 3. 点击 turn 触发 onSelectTurn
  it('calls onSelectTurn when a turn is clicked', async () => {
    const user = userEvent.setup();
    const onSelectTurn = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        onSelectTurn={onSelectTurn}
      />,
    );

    await user.click(screen.getByText('Second question'));
    expect(onSelectTurn).toHaveBeenCalledTimes(1);
    expect(onSelectTurn).toHaveBeenCalledWith(sampleTurns[1]);
  });

  it('does not crash when onSelectTurn is not provided and a turn is clicked', async () => {
    const user = userEvent.setup();
    render(<ConversationTimeline turns={sampleTurns} />);
    // Should not throw
    await user.click(screen.getByText('First question'));
  });

  // 4. 回退到历史 turn
  it('shows "checkout" button for non-last turns', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        activeTurnId="turn-3"
        onCheckoutTurn={vi.fn()}
        language="en-US"
      />,
    );

    const checkoutButtons = screen.getAllByRole('button', { name: /checkout/i });
    expect(checkoutButtons).toHaveLength(2);
  });

  it('calls onCheckoutTurn with correct args when checkout button is clicked', async () => {
    const user = userEvent.setup();
    const onCheckoutTurn = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        activeTurnId="turn-3"
        onCheckoutTurn={onCheckoutTurn}
        language="en-US"
      />,
    );

    const checkoutButtons = screen.getAllByRole('button', { name: /checkout/i });
    await user.click(checkoutButtons[0]);

    expect(onCheckoutTurn).toHaveBeenCalledTimes(1);
    expect(onCheckoutTurn).toHaveBeenCalledWith(
      'session-1',
      'branch-main',
      sampleTurns[0].id,
    );
  });

  it('hides checkout button for the last turn', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        activeTurnId="turn-3"
        onCheckoutTurn={vi.fn()}
        language="en-US"
      />,
    );

    const items = screen.getAllByRole('listitem');
    const lastItem = items[items.length - 1];
    const checkoutInLast = within(lastItem).queryByRole('button', { name: /checkout/i });
    expect(checkoutInLast).toBeNull();
  });

  // 5. 从此创建分支
  it('shows "branch from here" button for every turn', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        onForkFromTurn={vi.fn()}
        language="en-US"
      />,
    );

    const forkButtons = screen.getAllByRole('button', { name: /branch from here/i });
    expect(forkButtons).toHaveLength(3);
  });

  it('calls onForkFromTurn when branch-from-here is clicked', async () => {
    const user = userEvent.setup();
    const onForkFromTurn = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        onForkFromTurn={onForkFromTurn}
        language="en-US"
      />,
    );

    const forkButtons = screen.getAllByRole('button', { name: /branch from here/i });
    await user.click(forkButtons[1]);

    expect(onForkFromTurn).toHaveBeenCalledTimes(1);
    expect(onForkFromTurn).toHaveBeenCalledWith(sampleTurns[1].id);
  });

  it('shows branch-from-here button for the last turn', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        onForkFromTurn={vi.fn()}
        language="en-US"
      />,
    );

    const items = screen.getAllByRole('listitem');
    const lastItem = items[items.length - 1];
    expect(within(lastItem).getByRole('button', { name: /branch from here/i })).toBeInTheDocument();
  });

  // 6. 分支切换
  it('renders branch switcher when multiple branches are provided', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onSwitchBranch={vi.fn()}
        language="en-US"
      />,
    );

    expect(screen.getByRole('combobox', { name: /branch/i })).toBeInTheDocument();
  });

  it('does not render branch switcher when only one branch is provided', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={[sampleBranches[0]]}
        activeBranchId="branch-main"
        language="en-US"
      />,
    );

    expect(screen.queryByRole('combobox', { name: /branch/i })).toBeNull();
  });

  it('calls onSwitchBranch when a different branch is selected', async () => {
    const user = userEvent.setup();
    const onSwitchBranch = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onSwitchBranch={onSwitchBranch}
        language="en-US"
      />,
    );

    const select = screen.getByRole('combobox', { name: /branch/i });
    await user.selectOptions(select, 'branch-explore');

    expect(onSwitchBranch).toHaveBeenCalledWith('session-1', 'branch-explore');
  });

  it('selects the active branch by default', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-explore"
        language="en-US"
      />,
    );

    const select = screen.getByRole('combobox', { name: /branch/i }) as HTMLSelectElement;
    expect(select.value).toBe('branch-explore');
  });

  // 7. 分支重命名
  it('shows rename input when rename button is clicked', async () => {
    const user = userEvent.setup();
    const onRenameBranch = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onRenameBranch={onRenameBranch}
        language="en-US"
      />,
    );

    const renameButton = screen.getByRole('button', { name: /rename branch/i });
    await user.click(renameButton);

    const input = screen.getByRole('textbox', { name: /branch name/i });
    expect(input).toBeInTheDocument();
  });

  it('calls onRenameBranch when a new name is submitted', async () => {
    const user = userEvent.setup();
    const onRenameBranch = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onRenameBranch={onRenameBranch}
        language="en-US"
      />,
    );

    const renameButton = screen.getByRole('button', { name: /rename branch/i });
    await user.click(renameButton);

    const input = screen.getByRole('textbox', { name: /branch name/i });
    await user.clear(input);
    await user.type(input, 'feature-branch');
    await user.keyboard('{Enter}');

    expect(onRenameBranch).toHaveBeenCalledWith('session-1', 'branch-main', 'feature-branch');
  });

  it('cancels rename on Escape', async () => {
    const user = userEvent.setup();
    const onRenameBranch = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onRenameBranch={onRenameBranch}
        language="en-US"
      />,
    );

    const renameButton = screen.getByRole('button', { name: /rename branch/i });
    await user.click(renameButton);

    const input = screen.getByRole('textbox', { name: /branch name/i });
    await user.type(input, 'new-name');
    await user.keyboard('{Escape}');

    expect(onRenameBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /branch name/i })).toBeNull();
  });

  it('does not submit empty branch name', async () => {
    const user = userEvent.setup();
    const onRenameBranch = vi.fn();

    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onRenameBranch={onRenameBranch}
        language="en-US"
      />,
    );

    const renameButton = screen.getByRole('button', { name: /rename branch/i });
    await user.click(renameButton);

    const input = screen.getByRole('textbox', { name: /branch name/i });
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(onRenameBranch).not.toHaveBeenCalled();
  });

  // i18n
  it('renders Chinese labels when language is zh-CN', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        branches={sampleBranches}
        activeBranchId="branch-main"
        onCheckoutTurn={vi.fn()}
        onForkFromTurn={vi.fn()}
        onSwitchBranch={vi.fn()}
        onRenameBranch={vi.fn()}
        language="zh-CN"
      />,
    );

    expect(screen.getByText('分支')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /回退/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /创建分支/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /重命名分支/ })).toBeInTheDocument();
  });

  it('defaults to zh-CN when language is not specified', () => {
    render(
      <ConversationTimeline
        turns={sampleTurns}
        onCheckoutTurn={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /回退/ }).length).toBeGreaterThan(0);
  });

  // turn status display
  it('displays turn status icon', () => {
    const turns: AnalysisTurn[] = [
      makeTurn({ id: 'turn-1', status: 'completed' }),
      makeTurn({ id: 'turn-2', status: 'running' }),
      makeTurn({ id: 'turn-3', status: 'failed' }),
    ];

    render(<ConversationTimeline turns={turns} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('displays tool call count for each turn', () => {
    const turns: AnalysisTurn[] = [
      makeTurn({ id: 'turn-1', toolCallCount: 5 }),
    ];

    render(<ConversationTimeline turns={turns} language="en-US" />);
    expect(screen.getByText('5 tools')).toBeInTheDocument();
  });

  it('displays singular "tool" when toolCallCount is 1', () => {
    const turns: AnalysisTurn[] = [
      makeTurn({ id: 'turn-1', toolCallCount: 1 }),
    ];

    render(<ConversationTimeline turns={turns} language="en-US" />);
    expect(screen.getByText('1 tool')).toBeInTheDocument();
  });
});
