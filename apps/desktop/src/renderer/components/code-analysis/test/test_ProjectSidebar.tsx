import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProjectSidebar } from '../ProjectSidebar';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import type { AnalysisSession } from '@ai-reader/shared';

afterEach(() => {
  cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<AnalysisSession> = {}): AnalysisSession {
  return {
    id: 'session-1',
    projectId: null,
    title: 'Test Session',
    status: 'active',
    activeBranchId: null,
    activeDocumentId: null,
    archivedAt: null,
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
    ...overrides,
  };
}

const defaultLabels = {
  projects: '项目',
  recentConversations: '最近会话',
  localDocuments: '无项目',
  noProjects: '暂无项目',
  noConversations: '暂无会话',
  selectDirectory: '选择目录',
  language: '语言',
  chinese: '中文',
  english: 'English',
  activeSessions: 'Active',
  archivedSessions: 'Archived',
  manageSession: 'Manage session',
  renameSession: 'Rename',
  archiveSession: 'Archive',
  restoreSession: 'Restore',
  deleteSession: 'Delete',
  confirmDelete: 'Delete permanently',
  cancel: 'Cancel',
  sessionTitle: 'Session title',
  invalidSessionTitle: 'Enter a title between 1 and 80 characters',
  deleteSessionWarning: 'This permanently deletes the session and all related data.',
  newSession: 'New session',
};

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const defaults = {
    projects: [],
    recentDocuments: [],
    localDocuments: [],
    documentsByProject: {},
    expandedProjectIds: new Set<string>(),
    language: 'zh-CN' as const,
    labels: defaultLabels,
    onSelectDirectory: vi.fn(),
    onToggleProject: vi.fn(),
    onSelectLocal: vi.fn(),
    onSelectDocument: vi.fn(),
    onLanguageChange: vi.fn(),
  };
  return render(
    <ThemeProvider>
      <ProjectSidebar {...defaults} {...overrides} />
    </ThemeProvider>,
  );
}

// ── Session List Rendering ───────────────────────────────────────────────────

describe('ProjectSidebar session list', () => {
  it('should render recent sessions when recentSessions prop is provided', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Analysis of main.ts' }),
      makeSession({ id: 's2', title: 'Review utils.ts' }),
    ];

    renderSidebar({ recentSessions: sessions });

    expect(screen.getByText('Analysis of main.ts')).toBeInTheDocument();
    expect(screen.getByText('Review utils.ts')).toBeInTheDocument();
  });

  it('should display session titles instead of document goals', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session Title Here' }),
    ];

    renderSidebar({ recentSessions: sessions });

    expect(screen.getByText('Session Title Here')).toBeInTheDocument();
  });

  it('should show empty state when recentSessions is empty', () => {
    renderSidebar({ recentSessions: [], selectedSessionId: undefined });

    expect(screen.getByText('暂无会话')).toBeInTheDocument();
  });

  it('should highlight the selected session', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session A' }),
      makeSession({ id: 's2', title: 'Session B' }),
    ];

    renderSidebar({ recentSessions: sessions, selectedSessionId: 's1' });

    const sessionA = screen.getByText('Session A').closest('button');
    expect(sessionA).toHaveAttribute('data-active', 'true');

    const sessionB = screen.getByText('Session B').closest('button');
    expect(sessionB).toHaveAttribute('data-active', 'false');
  });

  it('should render sessions in recent section', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session in Recent' }),
    ];

    renderSidebar({ recentSessions: sessions });

    expect(screen.getByText('Session in Recent')).toBeInTheDocument();
  });
});

// ── Session Selection ────────────────────────────────────────────────────────

describe('ProjectSidebar session selection', () => {
  it('should call onSelectSession when a session is clicked', () => {
    const onSelectSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Click Me' }),
    ];

    renderSidebar({ recentSessions: sessions, onSelectSession });

    fireEvent.click(screen.getByText('Click Me'));
    expect(onSelectSession).toHaveBeenCalledTimes(1);
    expect(onSelectSession).toHaveBeenCalledWith(sessions[0]);
  });

  it('should support aria-pressed on session buttons', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session A' }),
    ];

    renderSidebar({ recentSessions: sessions, selectedSessionId: 's1' });

    const button = screen.getByText('Session A').closest('button');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ProjectSidebar session management', () => {
  it('opens a visible management menu for an active session', () => {
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Managed session' })],
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Managed session' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'Manage session: Managed session' }),
    ).toHaveFocus();
  });

  it('renames on Enter once and trims the title', () => {
    const onRenameSession = vi.fn();
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Old title' })],
      onRenameSession,
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Old title' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(input, { target: { value: '  New title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(onRenameSession).toHaveBeenCalledTimes(1);
    expect(onRenameSession).toHaveBeenCalledWith('s1', 'New title');
  });

  it('saves a valid rename on blur and cancels on Escape', () => {
    const onRenameSession = vi.fn();
    renderSidebar({
      recentSessions: [
        makeSession({ id: 's1', title: 'Blur title' }),
        makeSession({ id: 's2', title: 'Escape title' }),
      ],
      onRenameSession,
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Blur title' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const blurInput = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(blurInput, { target: { value: 'Saved on blur' } });
    fireEvent.blur(blurInput);

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Escape title' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const escapeInput = screen.getByRole('textbox', { name: 'Session title' });
    fireEvent.change(escapeInput, { target: { value: 'Do not save' } });
    fireEvent.keyDown(escapeInput, { key: 'Escape' });

    expect(onRenameSession).toHaveBeenCalledTimes(1);
    expect(onRenameSession).toHaveBeenCalledWith('s1', 'Saved on blur');
  });

  it('keeps the editor open for empty and overlong titles', () => {
    const onRenameSession = vi.fn();
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Validated title' })],
      onRenameSession,
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Validated title' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Session title' });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent(defaultLabels.invalidSessionTitle);

    fireEvent.change(input, { target: { value: 'x'.repeat(81) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent(defaultLabels.invalidSessionTitle);
    expect(onRenameSession).not.toHaveBeenCalled();
  });

  it('archives an active session', () => {
    const onArchiveSession = vi.fn();
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Active session' })],
      onArchiveSession,
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Active session' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    expect(onArchiveSession).toHaveBeenCalledWith('s1');
  });

  it('restores an archived session instead of offering archive', () => {
    const onRestoreSession = vi.fn();
    renderSidebar({
      recentSessions: [
        makeSession({ id: 's2', title: 'Archived session', status: 'archived' }),
      ],
      onRestoreSession,
      sessionStatus: 'archived',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Archived session' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore' }));

    expect(onRestoreSession).toHaveBeenCalledWith('s2');
  });

  it('requires explicit confirmation before permanent deletion', () => {
    const onDeleteSession = vi.fn();
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Delete me' })],
      onDeleteSession,
      sessionStatus: 'active',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Delete me' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete me');
    expect(dialog).toHaveTextContent(defaultLabels.deleteSessionWarning);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(onDeleteSession).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Delete me' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete permanently',
      }),
    );
    expect(onDeleteSession).toHaveBeenCalledWith('s1');
  });

  it('switches between active and archived session views', () => {
    const onSessionStatusChange = vi.fn();
    renderSidebar({
      recentSessions: [],
      sessionStatus: 'active',
      onSessionStatusChange,
    });

    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(onSessionStatusChange).toHaveBeenCalledWith('archived');
  });

  it('offers a new session action for no-project and project folders', () => {
    const onCreateSession = vi.fn();
    renderSidebar({
      projects: [{ id: 'p1', name: 'Project Alpha' }],
      recentSessions: [],
      onCreateSession,
    });

    fireEvent.click(
      screen.getByRole('button', { name: `New session: ${defaultLabels.localDocuments}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'New session: Project Alpha' }));

    expect(onCreateSession).toHaveBeenNthCalledWith(1, null);
    expect(onCreateSession).toHaveBeenNthCalledWith(2, 'p1');
  });

  it('shows archivedConversationCount for collapsed projects in archived view', () => {
    renderSidebar({
      projects: [
        { id: 'p1', name: 'Project Alpha', conversationCount: 2, archivedConversationCount: 5 },
      ],
      recentSessions: [makeSession()],
      sessionStatus: 'archived',
    });

    const folder = screen.getByTestId('project-p1');
    expect(within(folder).getByText('5')).toBeInTheDocument();
  });

  it('shows conversationCount for collapsed projects in active view', () => {
    renderSidebar({
      projects: [
        { id: 'p1', name: 'Project Alpha', conversationCount: 2, archivedConversationCount: 5 },
      ],
      recentSessions: [makeSession()],
      sessionStatus: 'active',
    });

    const folder = screen.getByTestId('project-p1');
    expect(within(folder).getByText('2')).toBeInTheDocument();
  });

  it('disables destructive actions for the running session', () => {
    renderSidebar({
      recentSessions: [makeSession({ id: 's1', title: 'Running session' })],
      selectedSessionId: 's1',
      sessionActionsDisabled: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Manage session: Running session' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });
});

// ── Backward Compatibility ───────────────────────────────────────────────────

describe('ProjectSidebar backward compatibility', () => {
  it('should still render recentDocuments when recentSessions is not provided', () => {
    const documents = [
      { id: 'd1', goal: 'Analyze main.ts', projectId: null },
    ];

    renderSidebar({ recentDocuments: documents });

    expect(screen.getByText('Analyze main.ts')).toBeInTheDocument();
  });

  it('should prefer recentSessions over recentDocuments when both provided', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session Mode' }),
    ];
    const documents = [
      { id: 'd1', goal: 'Document Mode', projectId: null },
    ];

    renderSidebar({ recentSessions: sessions, recentDocuments: documents });

    expect(screen.getByText('Session Mode')).toBeInTheDocument();
    expect(screen.queryByText('Document Mode')).not.toBeInTheDocument();
  });
});

// ── Project Tree ─────────────────────────────────────────────────────────────

describe('ProjectSidebar project tree', () => {
  it('should render projects before recent conversations', () => {
    renderSidebar({
      projects: [{ id: 'p1', name: 'Project Alpha' }],
      recentSessions: [makeSession({ id: 's1', title: 'Recent session' })],
      labels: {
        ...defaultLabels,
        projects: 'Projects',
        recentConversations: 'Recent conversations',
      },
    });

    const projectSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    const recentSection = screen
      .getByRole('heading', { name: 'Recent conversations' })
      .closest('section');

    expect(
      projectSection?.compareDocumentPosition(recentSection as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('should render project folders', () => {
    const projects = [
      { id: 'p1', name: 'Project Alpha' },
      { id: 'p2', name: 'Project Beta' },
    ];

    renderSidebar({ projects });

    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Project Beta')).toBeInTheDocument();
  });

  it('should render local documents folder', () => {
    renderSidebar();

    expect(screen.getByText('无项目')).toBeInTheDocument();
  });

  it('should call onToggleProject when clicking project', () => {
    const onToggleProject = vi.fn();
    const projects = [
      { id: 'p1', name: 'Click Project' },
    ];

    renderSidebar({ projects, onToggleProject });

    fireEvent.click(screen.getByText('Click Project'));
    expect(onToggleProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'Click Project' })
    );
  });

  it('should show no projects message when projects is empty', () => {
    renderSidebar({ projects: [] });

    expect(screen.getByText('暂无项目')).toBeInTheDocument();
  });
});
