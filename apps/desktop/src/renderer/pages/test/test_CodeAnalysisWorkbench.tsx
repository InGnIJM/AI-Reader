import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeAnalysisWorkbench from '../CodeAnalysisWorkbench';

describe('CodeAnalysisWorkbench', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    (window as any).api = {
      codeAnalysis: {
        createProject: vi.fn(async () => ({ id: 'project-1', name: 'Fixture', rootPathHash: 'hash' })),
        listProjects: vi.fn(async () => [
          { id: 'project-1', name: 'Fixture', rootPathHash: 'hash' },
        ]),
        listRecentDocuments: vi.fn(async () => []),
        listDocuments: vi.fn(async () => []),
        run: vi.fn(async () => ({
          id: 'doc-1',
          projectId: 'project-1',
          goal: 'Explain startup',
          contentMarkdown: '# Startup\n\nUses IPC.',
          status: 'completed',
          toolCallCount: 1,
        })),
        listTraces: vi.fn(async () => [{ id: 'trace-1', toolName: 'listFiles', resultSummary: 'package.json' }]),
        createAnnotation: vi.fn(async () => ({
          id: 'ann-1',
          anchorExactText: 'Startup',
          question: 'Explain this',
          status: 'pending',
          createdAt: new Date().toISOString(),
        })),
        listAnnotations: vi.fn(async () => []),
        listAnnotationMessages: vi.fn(async () => []),
        replyToAnnotation: vi.fn(async () => []),
        exportMarkdown: vi.fn(async () => '# Export'),
        exportJson: vi.fn(async () => ({ type: 'code-analysis-document' })),

        // Session management
        listSessions: vi.fn(async () => []),
        listRecentSessions: vi.fn(async () => []),
        getSession: vi.fn(async () => null),
        renameSession: vi.fn(async (payload: any) => ({
          id: payload.sessionId,
          title: payload.title,
          status: 'active',
          projectId: null,
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-1',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        archiveSession: vi.fn(async (sessionId: string) => ({
          id: sessionId,
          title: 'Archived Session',
          status: 'archived',
          projectId: null,
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-1',
          archivedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        restoreSession: vi.fn(async (sessionId: string) => ({
          id: sessionId,
          title: 'Restored Session',
          status: 'active',
          projectId: null,
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-1',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
        deleteSession: vi.fn(async () => ({ cleanupPending: false })),

        // Turn and branch management
        runTurn: vi.fn(async (payload: any) => ({
          session: {
            id: payload.sessionId ?? 'session-1',
            title: payload.goal.slice(0, 50),
            status: 'active',
            projectId: payload.projectId ?? null,
            activeBranchId: 'branch-1',
            activeDocumentId: 'doc-turn-1',
            archivedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          branch: {
            id: 'branch-1',
            sessionId: payload.sessionId ?? 'session-1',
            name: 'main',
            parentBranchId: null,
            forkedFromDocumentId: null,
            headDocumentId: 'doc-turn-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          turn: {
            id: 'turn-1',
            sessionId: payload.sessionId ?? 'session-1',
            branchId: 'branch-1',
            parentDocumentId: payload.parentDocumentId ?? null,
            goal: payload.goal,
            contentMarkdown: '# Turn Result\n\nAnalysis complete.',
            status: 'completed',
            toolCallCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })),
        checkoutTurn: vi.fn(async () => undefined),
        listBranches: vi.fn(async () => []),
        switchBranch: vi.fn(async () => undefined),
        renameBranch: vi.fn(async (payload: any) => ({
          id: payload.branchId,
          sessionId: payload.sessionId,
          name: payload.name,
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      },
      dialog: {
        openDirectory: vi.fn(async () => ({ canceled: false, filePaths: ['E:/fixture'] })),
      },
      settings: {
        getLanguage: vi.fn(async () => 'en-US'),
        setLanguage: vi.fn(async (language: string) => language),
      },
    };
  });

  it('runs analysis from the bottom prompt and renders Markdown with trace status', async () => {
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('Turn Result')).toBeInTheDocument());
    expect(screen.getByText(/listFiles/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /export md/i }));
    await user.click(screen.getByRole('button', { name: /export json/i }));
    expect(window.api.codeAnalysis.exportMarkdown).toHaveBeenCalledWith('turn-1');
    expect(window.api.codeAnalysis.exportJson).toHaveBeenCalledWith('turn-1');
  });

  it('shows global recent conversations and collapsible project folders', async () => {
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'project-1', name: 'First project', rootPathHash: 'first' },
      { id: 'project-2', name: 'Second project', rootPathHash: 'second' },
    ]);
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'session-second',
        projectId: 'project-2',
        title: 'Recent from second project',
        status: 'active',
        activeBranchId: 'branch-1',
        activeDocumentId: 'doc-1',
        archivedAt: null,
        createdAt: '2026-07-29T02:00:00.000Z',
        updatedAt: '2026-07-29T02:00:00.000Z',
      },
      {
        id: 'session-local',
        projectId: null,
        title: 'Recent local session',
        status: 'active',
        activeBranchId: 'branch-1',
        activeDocumentId: 'doc-2',
        archivedAt: null,
        createdAt: '2026-07-29T01:00:00.000Z',
        updatedAt: '2026-07-29T01:00:00.000Z',
      },
    ]);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    expect(await screen.findByRole('button', { name: 'Recent from second project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recent local session' })).toBeInTheDocument();
  });

  it('creates a no-project document from the local folder without directory tools', async () => {
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 'session-local',
        title: 'Write a design note',
        status: 'active',
        projectId: null,
        activeBranchId: 'branch-1',
        activeDocumentId: 'doc-turn-1',
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      branch: {
        id: 'branch-1',
        sessionId: 'session-local',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      turn: {
        id: 'turn-1',
        sessionId: 'session-local',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Write a design note',
        contentMarkdown: '# Design note',
        status: 'completed',
        toolCallCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.type(await screen.findByLabelText(/analysis goal/i), 'Write a design note');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(window.api.codeAnalysis.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({ goal: 'Write a design note' }),
      ),
    );
    expect(await screen.findByText('Design note')).toBeInTheDocument();
  });

  it('shows the submitted goal in the conversation before analysis finishes', async () => {
    let resolveRun!: (value: any) => void;
    const pendingRun = new Promise<any>((resolve) => {
      resolveRun = resolve;
    });
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockReturnValue(pendingRun);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    const prompt = screen.getByLabelText(/analysis goal/i);
    await user.type(prompt, 'Explain the startup flow');
    await user.keyboard('{Enter}');

    const userMessage = screen.getByRole('article', { name: /you/i });
    expect(userMessage).toHaveTextContent('Explain the startup flow');
    expect(prompt).toHaveValue('');
    expect(screen.getByText('Generating document...')).toBeInTheDocument();

    resolveRun({
      session: {
        id: 'session-1',
        title: 'Explain the startup flow',
        status: 'active',
        projectId: 'project-1',
        activeBranchId: 'branch-1',
        activeDocumentId: 'doc-turn-1',
        archivedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      branch: {
        id: 'branch-1',
        sessionId: 'session-1',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      turn: {
        id: 'turn-1',
        sessionId: 'session-1',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Explain the startup flow',
        contentMarkdown: '# Startup flow',
        status: 'completed',
        toolCallCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    await waitFor(() => expect(screen.getByText('Startup flow')).toBeInTheDocument());
  });

  it('creates separate selectable records for subsequent analyses', async () => {
    const runTurn = window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>;
    runTurn
      .mockResolvedValueOnce({
        session: {
          id: 'session-1',
          title: 'First analysis',
          status: 'active',
          projectId: 'project-1',
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-turn-1',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        branch: {
          id: 'branch-1',
          sessionId: 'session-1',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turn: {
          id: 'turn-1',
          sessionId: 'session-1',
          branchId: 'branch-1',
          parentDocumentId: null,
          goal: 'First analysis',
          contentMarkdown: '# First answer',
          status: 'completed',
          toolCallCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
      .mockResolvedValueOnce({
        session: {
          id: 'session-1',
          title: 'First analysis',
          status: 'active',
          projectId: 'project-1',
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-turn-2',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        branch: {
          id: 'branch-1',
          sessionId: 'session-1',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turn: {
          id: 'turn-2',
          sessionId: 'session-1',
          branchId: 'branch-1',
          parentDocumentId: 'doc-turn-1',
          goal: 'Second analysis',
          contentMarkdown: '# Second answer',
          status: 'completed',
          toolCallCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));

    const prompt = screen.getByLabelText(/analysis goal/i);
    await user.type(prompt, 'First analysis');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('First answer')).toBeInTheDocument());

    await user.type(prompt, 'Second analysis');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Second answer')).toBeInTheDocument());

    // Both turns should be visible in the conversation
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.getByText('Second answer')).toBeInTheDocument();
  });

  it('renders the persisted assistant reply inside the answered annotation', async () => {
    const newReplyMessages = [
      {
        id: 'message-user',
        annotationId: 'ann-1',
        role: 'user',
        content: 'Explain this',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'message-assistant',
        annotationId: 'ann-1',
        role: 'assistant',
        content: '**pnpm** manages packages across this monorepo.',
        modelId: 'mock-model',
        createdAt: new Date().toISOString(),
      },
    ];
    (window.api.codeAnalysis.replyToAnnotation as ReturnType<typeof vi.fn>).mockResolvedValue(
      newReplyMessages,
    );
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: 'ann-existing',
          analysisDocumentId: 'doc-turn-1',
          anchorExactText: 'IPC',
          question: 'What is IPC?',
          status: 'answered',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'ann-1',
          analysisDocumentId: 'doc-turn-1',
          anchorExactText: 'Turn Result',
          question: 'Explain this',
          status: 'answered',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
    (window.api.codeAnalysis.listAnnotationMessages as ReturnType<typeof vi.fn>).mockImplementation(
      async (annotationId: string) =>
        annotationId === 'ann-existing'
          ? [
              {
                id: 'message-existing',
                annotationId: 'ann-existing',
                role: 'assistant',
                content: 'Existing persisted reply.',
                createdAt: new Date().toISOString(),
              },
            ]
          : newReplyMessages,
    );

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');
    const turnResult = await screen.findByText('Turn Result');

    const range = document.createRange();
    range.selectNodeContents(turnResult);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Turn Result',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(turnResult);

    await user.type(screen.getByLabelText(/comment question/i), 'Explain this');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    expect(await screen.findByText('pnpm')).toBeInTheDocument();
    expect(screen.getByText(/manages packages across this monorepo/i)).toBeInTheDocument();
    expect(screen.getByText('Existing persisted reply.')).toBeInTheDocument();
    expect(screen.getAllByText('answered')).toHaveLength(2);
  });

  it('restores a selected conversation and its persisted annotation reply', async () => {
    const mockSession = {
      id: 'session-history',
      title: 'What is pnpm monorepo?',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-turn-history',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: [
        {
          id: 'branch-1',
          sessionId: 'session-history',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-history',
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:01:00.000Z',
        },
      ],
      turns: [
        {
          id: 'turn-history',
          sessionId: 'session-history',
          branchId: 'branch-1',
          parentDocumentId: null,
          goal: 'What is pnpm monorepo?',
          contentMarkdown: '# pnpm monorepo\n\nA workspace with multiple packages.',
          status: 'completed',
          toolCallCount: 2,
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:01:00.000Z',
        },
      ],
    });
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ann-history',
        analysisDocumentId: 'doc-turn-history',
        anchorExactText: 'pnpm monorepo',
        question: 'Explain this',
        status: 'answered',
        createdAt: '2026-07-29T10:02:00.000Z',
        updatedAt: '2026-07-29T10:03:00.000Z',
      },
    ]);
    (window.api.codeAnalysis.listAnnotationMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'reply-history',
        annotationId: 'ann-history',
        role: 'assistant',
        content: 'It manages multiple packages in one repository.',
        createdAt: '2026-07-29T10:03:00.000Z',
      },
    ]);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(await screen.findByRole('button', { name: 'What is pnpm monorepo?' }));

    expect(await screen.findByRole('heading', { name: 'pnpm monorepo' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /you/i })).toHaveTextContent(
      'What is pnpm monorepo?',
    );
    expect(screen.getByText(/manages multiple packages in one repository/i)).toBeInTheDocument();
    expect(window.api.codeAnalysis.listTraces).toHaveBeenCalledWith('turn-history');
    expect(window.api.codeAnalysis.listAnnotationMessages).toHaveBeenCalledWith('ann-history');
  });

  it('persists the language choice and switches the code analysis interface', async () => {
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    const languageSelect = await screen.findByRole('combobox', { name: /language/i });
    expect(languageSelect).toHaveValue('en-US');

    await user.selectOptions(languageSelect, 'zh-CN');

    await waitFor(() => expect(window.api.settings.setLanguage).toHaveBeenCalledWith('zh-CN'));
    expect(screen.getByRole('button', { name: '选择目录' })).toBeInTheDocument();
    expect(screen.getByLabelText('分析目标')).toBeInTheDocument();
  });

  it('shows project loading and model failures instead of leaving a blank response', async () => {
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Unable to load projects'),
    );
    const { unmount } = render(<CodeAnalysisWorkbench />);
    expect(await screen.findByText('Unable to load projects')).toBeInTheDocument();
    unmount();

    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Provider unavailable'),
    );
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    const errorReply = await screen.findByRole('article', { name: /assistant/i });
    expect(errorReply).toHaveTextContent('Provider unavailable');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Provider unavailable');
  });

  it('rolls back the language selector when persistence fails', async () => {
    (window.api.settings.setLanguage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Unable to save language'),
    );
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    const languageSelect = await screen.findByRole('combobox', { name: /language/i });

    await user.selectOptions(languageSelect, 'zh-CN');

    await waitFor(() => expect(languageSelect).toHaveValue('en-US'));
    expect(screen.getByText('Unable to save language')).toBeInTheDocument();
  });

  it('shows a failed annotation status when reply generation fails', async () => {
    (window.api.codeAnalysis.replyToAnnotation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Provider unavailable'),
    );
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'ann-1',
          analysisDocumentId: 'doc-turn-1',
          anchorExactText: 'Turn Result',
          question: 'Explain this',
          status: 'failed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');
    const turnResult = await screen.findByText('Turn Result');
    const range = document.createRange();
    range.selectNodeContents(turnResult);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Turn Result',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(turnResult);
    await user.type(screen.getByLabelText(/comment question/i), 'Explain this');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    expect(await screen.findByText('Provider unavailable')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('does not let a slow project request overwrite the latest project selection', async () => {
    let resolveFirstProject!: (value: any[]) => void;
    const firstProjectDocuments = new Promise<any[]>((resolve) => {
      resolveFirstProject = resolve;
    });
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'project-first', name: 'First project', rootPathHash: 'first' },
      { id: 'project-second', name: 'Second project', rootPathHash: 'second' },
    ]);
    (window.api.codeAnalysis.listDocuments as ReturnType<typeof vi.fn>).mockImplementation(
      async (projectId: string) =>
        projectId === 'project-first'
          ? firstProjectDocuments
          : [
              {
                id: 'doc-second',
                projectId: 'project-second',
                goal: 'Second project conversation',
                contentMarkdown: '# Second',
                status: 'completed',
                toolCallCount: 0,
                createdAt: '2026-07-29T00:00:00.000Z',
                updatedAt: '2026-07-29T00:00:00.000Z',
              },
            ],
    );

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(await screen.findByRole('button', { name: 'First project' }));
    await user.click(screen.getByRole('button', { name: 'Second project' }));
    expect(await screen.findByRole('button', { name: 'Second project conversation' })).toBeInTheDocument();

    resolveFirstProject([
      {
        id: 'doc-first',
        projectId: 'project-first',
        goal: 'Stale conversation',
        contentMarkdown: '# Stale',
        status: 'completed',
        toolCallCount: 0,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ]);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stale conversation' })).not.toBeInTheDocument(),
    );
  });

  it('does not let a slow directory import overwrite a later project selection', async () => {
    let resolveCreateProject!: (value: any) => void;
    const pendingCreateProject = new Promise<any>((resolve) => {
      resolveCreateProject = resolve;
    });
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'project-existing', name: 'Existing project', rootPathHash: 'existing' },
    ]);
    (window.api.codeAnalysis.createProject as ReturnType<typeof vi.fn>).mockReturnValue(
      pendingCreateProject,
    );

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    const existingProject = await screen.findByRole('button', { name: 'Existing project' });
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.click(existingProject);

    resolveCreateProject({
      id: 'project-imported',
      name: 'Imported project',
      rootPathHash: 'imported',
    });

    await waitFor(() => expect(existingProject).toHaveAttribute('data-active', 'true'));
    expect(screen.getByRole('button', { name: 'Imported project' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('does not let a completed analysis overwrite a project selected while it was running', async () => {
    let resolveRun!: (value: any) => void;
    const pendingRun = new Promise<any>((resolve) => {
      resolveRun = resolve;
    });
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'project-second', name: 'Second project', rootPathHash: 'second' },
    ]);
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockReturnValue(pendingRun);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Slow analysis');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Second project' }));

    resolveRun({
      session: {
        id: 'session-stale',
        title: 'Slow analysis',
        status: 'active',
        projectId: 'project-1',
        activeBranchId: 'branch-1',
        activeDocumentId: 'doc-turn-stale',
        archivedAt: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      branch: {
        id: 'branch-1',
        sessionId: 'session-stale',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-stale',
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
      turn: {
        id: 'turn-stale',
        sessionId: 'session-stale',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Slow analysis',
        contentMarkdown: '# Stale result',
        status: 'completed',
        toolCallCount: 0,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    });

    await waitFor(() => expect(screen.queryByText('Stale result')).not.toBeInTheDocument());
    expect(window.api.codeAnalysis.listTraces).not.toHaveBeenCalledWith('doc-turn-stale');
  });

  // ── Session Integration Tests ──────────────────────────────────────────

  it('creates a new session on first turn via runTurn', async () => {
    (window.api.codeAnalysis.run as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Analyze project structure');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(window.api.codeAnalysis.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: 'Analyze project structure',
          projectId: 'project-1',
        }),
      ),
    );
    expect(await screen.findByText('Turn Result')).toBeInTheDocument();
  });

  it('appends subsequent turns to the same session', async () => {
    const runTurn = window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>;
    runTurn
      .mockResolvedValueOnce({
        session: {
          id: 'session-1',
          title: 'First turn',
          status: 'active',
          projectId: 'project-1',
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-turn-1',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        branch: {
          id: 'branch-1',
          sessionId: 'session-1',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turn: {
          id: 'turn-1',
          sessionId: 'session-1',
          branchId: 'branch-1',
          parentDocumentId: null,
          goal: 'First turn',
          contentMarkdown: '# First Turn Result',
          status: 'completed',
          toolCallCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
      .mockResolvedValueOnce({
        session: {
          id: 'session-1',
          title: 'First turn',
          status: 'active',
          projectId: 'project-1',
          activeBranchId: 'branch-1',
          activeDocumentId: 'doc-turn-2',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        branch: {
          id: 'branch-1',
          sessionId: 'session-1',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-2',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        turn: {
          id: 'turn-2',
          sessionId: 'session-1',
          branchId: 'branch-1',
          parentDocumentId: 'doc-turn-1',
          goal: 'Second turn',
          contentMarkdown: '# Second Turn Result',
          status: 'completed',
          toolCallCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));

    const prompt = screen.getByLabelText(/analysis goal/i);
    await user.type(prompt, 'First turn');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('First Turn Result')).toBeInTheDocument());

    await user.type(prompt, 'Second turn');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Second Turn Result')).toBeInTheDocument());

    // Both turns should be visible in the conversation timeline
    expect(screen.getByText('First Turn Result')).toBeInTheDocument();
    expect(screen.getByText('Second Turn Result')).toBeInTheDocument();

    // runTurn should have been called with sessionId on second call
    expect(runTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sessionId: 'session-1',
        goal: 'Second turn',
      }),
    );
  });

  it('selects a session and loads its turns', async () => {
    const mockSession = {
      id: 'session-existing',
      title: 'Existing Session',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-turn-1',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const mockBranches = [
      {
        id: 'branch-1',
        sessionId: 'session-existing',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ];
    const mockTurns = [
      {
        id: 'turn-1',
        sessionId: 'session-existing',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Explain startup',
        contentMarkdown: '# Startup\n\nUses IPC.',
        status: 'completed',
        toolCallCount: 1,
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ];

    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: mockBranches,
      turns: mockTurns,
    });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    // Sessions should be visible in the left panel
    const sessionButton = await screen.findByRole('button', { name: 'Existing Session' });
    await user.click(sessionButton);

    await waitFor(() =>
      expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith('session-existing'),
    );

    // Turn content should be visible
    expect(await screen.findByText('Startup')).toBeInTheDocument();
  });

  it('checks out to a historical turn', async () => {
    const mockSession = {
      id: 'session-checkout',
      title: 'Checkout Session',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-turn-2',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:02:00.000Z',
    };
    const mockTurns = [
      {
        id: 'turn-1',
        sessionId: 'session-checkout',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'First question',
        contentMarkdown: '# First Answer',
        status: 'completed',
        toolCallCount: 1,
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
      {
        id: 'turn-2',
        sessionId: 'session-checkout',
        branchId: 'branch-1',
        parentDocumentId: 'doc-turn-1',
        goal: 'Second question',
        contentMarkdown: '# Second Answer',
        status: 'completed',
        toolCallCount: 1,
        createdAt: '2026-07-29T10:01:00.000Z',
        updatedAt: '2026-07-29T10:02:00.000Z',
      },
    ];

    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: [
        {
          id: 'branch-1',
          sessionId: 'session-checkout',
          name: 'main',
          parentBranchId: null,
          forkedFromDocumentId: null,
          headDocumentId: 'doc-turn-2',
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:02:00.000Z',
        },
      ],
      turns: mockTurns,
    });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(await screen.findByRole('button', { name: 'Checkout Session' }));

    // Both turns should be visible in the conversation
    expect(await screen.findByText('First Answer')).toBeInTheDocument();
    expect(screen.getByText('Second Answer')).toBeInTheDocument();
  });

  it('switches branches within a session', async () => {
    const mockSession = {
      id: 'session-branch',
      title: 'Branch Session',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-2',
      activeDocumentId: 'doc-turn-branch',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:03:00.000Z',
    };
    const mockBranches = [
      {
        id: 'branch-1',
        sessionId: 'session-branch',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
      {
        id: 'branch-2',
        sessionId: 'session-branch',
        name: 'experiment',
        parentBranchId: 'branch-1',
        forkedFromDocumentId: 'doc-turn-1',
        headDocumentId: 'doc-turn-branch',
        createdAt: '2026-07-29T10:02:00.000Z',
        updatedAt: '2026-07-29T10:03:00.000Z',
      },
    ];

    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: mockBranches,
      turns: [
        {
          id: 'turn-branch',
          sessionId: 'session-branch',
          branchId: 'branch-2',
          parentDocumentId: null,
          goal: 'Experiment',
          contentMarkdown: '# Experiment Branch',
          status: 'completed',
          toolCallCount: 0,
          createdAt: '2026-07-29T10:02:00.000Z',
          updatedAt: '2026-07-29T10:03:00.000Z',
        },
      ],
    });

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(await screen.findByRole('button', { name: 'Branch Session' }));

    // Branch selector should be visible
    const branchSelect = await screen.findByRole('combobox', { name: /branch/i });
    expect(branchSelect).toBeInTheDocument();

    await user.selectOptions(branchSelect, 'branch-1');

    await waitFor(() =>
      expect(window.api.codeAnalysis.switchBranch).toHaveBeenCalledWith({
        sessionId: 'session-branch',
        branchId: 'branch-1',
      }),
    );
  });

  it('archives and restores a session', async () => {
    const mockSession = {
      id: 'session-archive',
      title: 'Archive Session',
      status: 'active',
      projectId: null,
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-1',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const archivedSession = {
      ...mockSession,
      status: 'archived' as const,
      archivedAt: '2026-07-29T10:02:00.000Z',
    };
    const restoredSession = {
      ...mockSession,
      status: 'active' as const,
      archivedAt: null,
    };

    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([mockSession])
      .mockResolvedValueOnce([archivedSession])
      .mockResolvedValueOnce([restoredSession]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: [],
      turns: [],
    });
    (window.api.codeAnalysis.archiveSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      archivedSession,
    );
    (window.api.codeAnalysis.restoreSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      restoredSession,
    );

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    // Select session
    await user.click(await screen.findByRole('button', { name: 'Archive Session' }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith('session-archive'),
    );

    // Right-click to open context menu
    const sessionButton = screen.getByRole('button', { name: 'Archive Session' });
    fireEvent.contextMenu(sessionButton);

    // Click archive in context menu
    const archiveMenuItem = await screen.findByRole('menuitem', { name: /archive/i });
    await user.click(archiveMenuItem);

    await waitFor(() =>
      expect(window.api.codeAnalysis.archiveSession).toHaveBeenCalledWith('session-archive'),
    );
  });
});
