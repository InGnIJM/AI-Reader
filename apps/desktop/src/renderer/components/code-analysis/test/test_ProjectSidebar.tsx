import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
