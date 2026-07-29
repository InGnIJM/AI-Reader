import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProjectSidebar } from '../ProjectSidebar';
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
  newSession: '新建会话',
  renameSession: '重命名',
  archiveSession: '归档',
  deleteSession: '删除',
  confirmDelete: '确认删除',
  cancel: '取消',
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
  return render(<ProjectSidebar {...defaults} {...overrides} />);
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

  it('should render sessions grouped by project when sessionsByProject is provided', () => {
    const projects = [
      { id: 'p1', name: 'Project Alpha' },
    ];
    const recentSessions: AnalysisSession[] = [];
    const sessionsByProject: Record<string, AnalysisSession[]> = {
      p1: [
        makeSession({ id: 's1', title: 'Session in Alpha', projectId: 'p1' }),
      ],
    };
    const expandedProjectIds = new Set(['p1']);

    renderSidebar({ projects, recentSessions, sessionsByProject, expandedProjectIds });

    expect(screen.getByText('Session in Alpha')).toBeInTheDocument();
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

// ── Session Management: Rename ───────────────────────────────────────────────

describe('ProjectSidebar session rename', () => {
  it('should show rename option in context menu when right-clicking a session', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Rename Me' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const sessionButton = screen.getByText('Rename Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);

    expect(screen.getByText('重命名')).toBeInTheDocument();
  });

  it('should show inline rename input when rename is triggered', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Old Title' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const sessionButton = screen.getByText('Old Title').closest('button')!;
    fireEvent.contextMenu(sessionButton);

    fireEvent.click(screen.getByText('重命名'));

    const input = screen.getByDisplayValue('Old Title');
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('should call onRenameSession with new title on confirm', () => {
    const onRenameSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Old Title' }),
    ];

    renderSidebar({ recentSessions: sessions, onRenameSession });

    const sessionButton = screen.getByText('Old Title').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('重命名'));

    const input = screen.getByDisplayValue('Old Title');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameSession).toHaveBeenCalledWith('s1', 'New Title');
  });

  it('should cancel rename on Escape key', () => {
    const onRenameSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Keep Title' }),
    ];

    renderSidebar({ recentSessions: sessions, onRenameSession });

    const sessionButton = screen.getByText('Keep Title').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('重命名'));

    const input = screen.getByDisplayValue('Keep Title');
    fireEvent.change(input, { target: { value: 'Changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameSession).not.toHaveBeenCalled();
    expect(screen.getByText('Keep Title')).toBeInTheDocument();
  });
});

// ── Session Management: Archive ──────────────────────────────────────────────

describe('ProjectSidebar session archive', () => {
  it('should show archive option in context menu', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Archive Me' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const sessionButton = screen.getByText('Archive Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);

    expect(screen.getByText('归档')).toBeInTheDocument();
  });

  it('should call onArchiveSession when archive is clicked', () => {
    const onArchiveSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Archive Me' }),
    ];

    renderSidebar({ recentSessions: sessions, onArchiveSession });

    const sessionButton = screen.getByText('Archive Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('归档'));

    expect(onArchiveSession).toHaveBeenCalledWith('s1');
  });
});

// ── Session Management: Delete ───────────────────────────────────────────────

describe('ProjectSidebar session delete', () => {
  it('should show delete option in context menu', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Delete Me' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const sessionButton = screen.getByText('Delete Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);

    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('should show confirmation dialog before deleting', () => {
    const onDeleteSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Delete Me' }),
    ];

    renderSidebar({ recentSessions: sessions, onDeleteSession });

    const sessionButton = screen.getByText('Delete Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('删除'));

    // Should show a confirmation prompt, not immediately call onDeleteSession
    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(screen.getByText('确认删除')).toBeInTheDocument();
  });

  it('should call onDeleteSession after confirmation', () => {
    const onDeleteSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Delete Me' }),
    ];

    renderSidebar({ recentSessions: sessions, onDeleteSession });

    const sessionButton = screen.getByText('Delete Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('确认删除'));

    expect(onDeleteSession).toHaveBeenCalledWith('s1');
  });

  it('should not call onDeleteSession when cancel is clicked', () => {
    const onDeleteSession = vi.fn();
    const sessions = [
      makeSession({ id: 's1', title: 'Keep Me' }),
    ];

    renderSidebar({ recentSessions: sessions, onDeleteSession });

    const sessionButton = screen.getByText('Keep Me').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getByText('取消'));

    expect(onDeleteSession).not.toHaveBeenCalled();
    expect(screen.getByText('Keep Me')).toBeInTheDocument();
  });
});

// ── New Session Button ───────────────────────────────────────────────────────

describe('ProjectSidebar new session', () => {
  it('should show new session button when onNewSession is provided', () => {
    const onNewSession = vi.fn();

    renderSidebar({ onNewSession });

    const button = screen.getByText('新建会话');
    expect(button).toBeInTheDocument();
  });

  it('should call onNewSession when new session button is clicked', () => {
    const onNewSession = vi.fn();

    renderSidebar({ onNewSession });

    fireEvent.click(screen.getByText('新建会话'));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});

// ── Archived Session Status ──────────────────────────────────────────────────

describe('ProjectSidebar archived session display', () => {
  it('should visually distinguish archived sessions from active ones', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Active Session', status: 'active' }),
      makeSession({ id: 's2', title: 'Archived Session', status: 'archived' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const activeBtn = screen.getByText('Active Session').closest('button')!;
    const archivedBtn = screen.getByText('Archived Session').closest('button')!;

    expect(activeBtn).toHaveAttribute('data-status', 'active');
    expect(archivedBtn).toHaveAttribute('data-status', 'archived');
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

// ── Context Menu Close ───────────────────────────────────────────────────────

describe('ProjectSidebar context menu close behavior', () => {
  it('should close context menu when clicking outside', () => {
    const sessions = [
      makeSession({ id: 's1', title: 'Session With Menu' }),
    ];

    renderSidebar({ recentSessions: sessions });

    const sessionButton = screen.getByText('Session With Menu').closest('button')!;
    fireEvent.contextMenu(sessionButton);
    expect(screen.getByText('重命名')).toBeInTheDocument();

    // Click elsewhere to close menu
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('重命名')).not.toBeInTheDocument();
  });
});
