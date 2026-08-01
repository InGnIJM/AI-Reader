import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeAnalysisWorkbench from '../CodeAnalysisWorkbench';
import { ThemeProvider } from '../../contexts/ThemeContext';

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
        deleteAnnotation: vi.fn(async () => undefined),
        exportDocument: vi.fn(async (_documentId: string, format: any) =>
          format === 'markdown'
            ? {
                format: 'markdown',
                defaultFileName: 'turn-1.md',
                content: '# Export',
              }
            : {
                format: 'json',
                defaultFileName: 'turn-1.json',
                content: JSON.stringify({ type: 'code-analysis-document' }),
              },
        ),

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
        forkSession: vi.fn(async () => ({
          id: 'session-fork',
          title: 'Forked session',
          status: 'active',
          projectId: null,
          activeBranchId: 'branch-fork',
          activeDocumentId: 'turn-fork',
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),

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
        saveFile: vi.fn(async () => ({
          canceled: false,
          filePath: 'C:/exports/turn-1.md',
        })),
      },
      settings: {
        getLanguage: vi.fn(async () => 'en-US'),
        setLanguage: vi.fn(async (language: string) => language),
      },
    };
  });

  it('renders the integrated title bar with the current local-session context', async () => {
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    const navigation = await screen.findByRole('navigation', { name: 'Current context' });
    expect(screen.getByText('AI Reader')).toBeInTheDocument();
    expect(within(navigation).getByText('Workspace')).toBeInTheDocument();
    expect(within(navigation).getByText('No project')).toBeInTheDocument();
    expect(within(navigation).getByText('New session')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument();
  });

  it('runs analysis from the bottom prompt and renders Markdown with trace status', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('Turn Result')).toBeInTheDocument());
    expect(screen.getByText(/listFiles/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /export md/i }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.exportDocument).toHaveBeenCalledWith('turn-1', 'markdown'),
    );
    expect(window.api.dialog.saveFile).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /export json/i }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.exportDocument).toHaveBeenCalledWith('turn-1', 'json'),
    );
    await waitFor(() => expect(screen.getByText(/Exported to/)).toBeInTheDocument());
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    expect(await screen.findByRole('button', { name: 'Recent from second project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recent local session' })).toBeInTheDocument();
  });

  it('loads the complete active session list when a project folder expands', async () => {
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'session-local-recent',
        projectId: null,
        title: 'Recent local session',
        status: 'active',
        activeBranchId: 'branch-local',
        activeDocumentId: 'doc-local',
        archivedAt: null,
        createdAt: '2026-07-30T01:00:00.000Z',
        updatedAt: '2026-07-30T01:00:00.000Z',
      },
    ]);
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'session-project-history',
        projectId: 'project-1',
        title: 'Older project session outside recents',
        status: 'active',
        activeBranchId: 'branch-project',
        activeDocumentId: 'doc-project',
        archivedAt: null,
        createdAt: '2026-07-28T01:00:00.000Z',
        updatedAt: '2026-07-28T01:00:00.000Z',
      },
    ]);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Fixture' }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.listSessions).toHaveBeenCalledWith({
        projectId: 'project-1',
        status: 'active',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Older project session outside recents' }),
    ).toBeInTheDocument();
  });

  it('counts a multi-turn project session only once', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Fixture' }));
    const prompt = screen.getByLabelText(/analysis goal/i);

    await user.type(prompt, 'First turn');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.api.codeAnalysis.runTurn).toHaveBeenCalledTimes(1));

    await user.type(prompt, 'Second turn');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.api.codeAnalysis.runTurn).toHaveBeenCalledTimes(2));

    expect(within(screen.getByTestId('project-project-1')).getByText('1')).toBeInTheDocument();
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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

  it('creates an annotation with source offsets from formatted markdown selection', async () => {
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 'session-1',
        title: 'Explain docs',
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
        id: 'doc-turn-1',
        sessionId: 'session-1',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Explain docs',
        contentMarkdown: 'Click [here](http://x.com) now',
        status: 'completed',
        toolCallCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain docs');
    await user.keyboard('{Enter}');
    const link = await screen.findByRole('link', { name: 'here' });
    const range = document.createRange();
    range.selectNodeContents(link);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'here',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(link);

    await user.type(screen.getByLabelText(/comment question/i), 'Explain this link');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.createAnnotation).toHaveBeenCalledWith({
        analysisDocumentId: 'doc-turn-1',
        selectedText: 'here',
        sourceStartOffset: 7,
        sourceEndOffset: 11,
        question: 'Explain this link',
      }),
    );
  });

  it('sends an annotation with Ctrl+Enter from the comment composer', async () => {
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 'session-kb',
        title: 'Explain docs',
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
        sessionId: 'session-kb',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      turn: {
        id: 'doc-turn-1',
        sessionId: 'session-kb',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Explain docs',
        contentMarkdown: 'Click [here](http://x.com) now',
        status: 'completed',
        toolCallCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain docs');
    await user.keyboard('{Enter}');
    const link = await screen.findByRole('link', { name: 'here' });
    const range = document.createRange();
    range.selectNodeContents(link);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'here',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(link);

    const composer = screen.getByLabelText(/comment question/i);
    await user.type(composer, 'Explain this link');
    await user.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() =>
      expect(window.api.codeAnalysis.createAnnotation).toHaveBeenCalledWith({
        analysisDocumentId: 'doc-turn-1',
        selectedText: 'here',
        sourceStartOffset: 7,
        sourceEndOffset: 11,
        question: 'Explain this link',
      }),
    );
  });

  it('deletes an annotation from the sidebar', async () => {
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: {
        id: 'session-del',
        title: 'Delete',
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
        sessionId: 'session-del',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'doc-turn-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      turn: {
        id: 'doc-turn-1',
        sessionId: 'session-del',
        branchId: 'branch-1',
        parentDocumentId: null,
        goal: 'Explain',
        contentMarkdown: 'Some content',
        status: 'completed',
        toolCallCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ann-del',
        analysisDocumentId: 'doc-turn-1',
        anchorExactText: 'content',
        selectedText: 'content',
        question: 'q',
        status: 'answered',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    (window.api.codeAnalysis.listAnnotationMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
      [
        {
          id: 'm1',
          annotationId: 'ann-del',
          role: 'assistant',
          content: 'reply',
          createdAt: new Date().toISOString(),
        },
      ],
    );

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain');
    await user.keyboard('{Enter}');

    const deleteBtn = await screen.findByTestId('annotation-delete-ann-del');
    await user.click(deleteBtn);
    expect(window.api.codeAnalysis.deleteAnnotation).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete permanently',
      }),
    );

    await waitFor(() =>
      expect(window.api.codeAnalysis.deleteAnnotation).toHaveBeenCalledWith('ann-del'),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('annotation-delete-ann-del')).not.toBeInTheDocument(),
    );
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'What is pnpm monorepo?' }));

    expect(await screen.findByRole('heading', { name: 'pnpm monorepo' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /you/i })).toHaveTextContent(
      'What is pnpm monorepo?',
    );
    expect(screen.getByText(/manages multiple packages in one repository/i)).toBeInTheDocument();
    expect(window.api.codeAnalysis.listTraces).toHaveBeenCalledWith('turn-history');
    expect(window.api.codeAnalysis.listAnnotationMessages).toHaveBeenCalledWith('ann-history');
  });

  it('allows creating an annotation after restoring a selected conversation', async () => {
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
          id: 'doc-turn-history',
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

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'What is pnpm monorepo?' }));
    const heading = await screen.findByRole('heading', { name: 'pnpm monorepo' });
    const range = document.createRange();
    range.selectNodeContents(heading);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'pnpm monorepo',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(heading);

    expect(await screen.findByLabelText(/comment question/i)).toBeInTheDocument();
  });

  it('restores the session active document instead of the final returned turn', async () => {
    const mockSession = {
      id: 'session-multi-turn',
      title: 'Multi-turn analysis',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-turn-first',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:02:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: [],
      turns: [
        {
          id: 'doc-turn-first',
          sessionId: 'session-multi-turn',
          branchId: 'branch-1',
          parentDocumentId: null,
          goal: 'First question',
          contentMarkdown: '# First answer',
          status: 'completed',
          toolCallCount: 0,
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:01:00.000Z',
        },
        {
          id: 'doc-turn-second',
          sessionId: 'session-multi-turn',
          branchId: 'branch-1',
          parentDocumentId: 'doc-turn-first',
          goal: 'Second question',
          contentMarkdown: '# Second answer',
          status: 'completed',
          toolCallCount: 0,
          createdAt: '2026-07-29T10:01:00.000Z',
          updatedAt: '2026-07-29T10:02:00.000Z',
        },
      ],
    });

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Multi-turn analysis' }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.listTraces).toHaveBeenCalledWith('doc-turn-first'),
    );
  });

  it('creates an annotation from a non-active turn in a restored conversation', async () => {
    const mockSession = {
      id: 'session-multi-turn',
      title: 'Multi-turn analysis',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-turn-second',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:02:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: mockSession,
      branches: [],
      turns: [
        {
          id: 'doc-turn-first',
          sessionId: 'session-multi-turn',
          branchId: 'branch-1',
          parentDocumentId: null,
          goal: 'First question',
          contentMarkdown: '# First answer',
          status: 'completed',
          toolCallCount: 0,
          createdAt: '2026-07-29T10:00:00.000Z',
          updatedAt: '2026-07-29T10:01:00.000Z',
        },
        {
          id: 'doc-turn-second',
          sessionId: 'session-multi-turn',
          branchId: 'branch-1',
          parentDocumentId: 'doc-turn-first',
          goal: 'Second question',
          contentMarkdown: '# Second answer',
          status: 'completed',
          toolCallCount: 0,
          createdAt: '2026-07-29T10:01:00.000Z',
          updatedAt: '2026-07-29T10:02:00.000Z',
        },
      ],
    });

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: 'Multi-turn analysis' }));

    const firstAnswer = await screen.findByRole('heading', { name: 'First answer' });
    const range = document.createRange();
    range.selectNodeContents(firstAnswer);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'First answer',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(firstAnswer);

    await user.type(await screen.findByLabelText(/comment question/i), 'Explain the first answer');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.createAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisDocumentId: 'doc-turn-first',
          selectedText: 'First answer',
          question: 'Explain the first answer',
        }),
      ),
    );
  });

  it('persists the language choice and switches the code analysis interface', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

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
    const { unmount } = render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    expect(await screen.findByText('Unable to load projects')).toBeInTheDocument();
    unmount();

    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Provider unavailable'),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    const errorReply = await screen.findByRole('article', { name: /assistant/i });
    expect(errorReply).toHaveTextContent('Provider unavailable');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Provider unavailable');
  });

  it('re-syncs the session overview when the first turn fails', async () => {
    (window.api.codeAnalysis.runTurn as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Provider unavailable'),
    );
    const listRecentSessions = window.api.codeAnalysis.listRecentSessions as ReturnType<
      typeof vi.fn
    >;
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    // runTurn persists the session before analysis; a failed first turn must
    // re-pull the recent list and project counts to stay consistent with the DB.
    await waitFor(() =>
      expect(listRecentSessions.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(window.api.codeAnalysis.listProjects).toHaveBeenCalled();
  });

  it('clears the selected text when a new turn runs', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'First analysis');
    await user.keyboard('{Enter}');
    const firstHeading = await screen.findByRole('heading', { name: 'Turn Result' });

    // Select the first result and type a question so the comment action is armed.
    const range = document.createRange();
    range.selectNodeContents(firstHeading);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Turn Result',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(firstHeading);
    await user.type(await screen.findByLabelText(/comment question/i), 'Question');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^comment$/i })).toBeEnabled(),
    );

    // Run a second turn; the stale selection from turn 1 must be cleared so the
    // comment composer (rendered only while selectedText is set) disappears and
    // no annotation can be anchored against the new document with old offsets.
    await user.type(screen.getByLabelText(/analysis goal/i), 'Second analysis');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.queryByLabelText(/comment question/i)).not.toBeInTheDocument(),
    );
  });

  it('rolls back the language selector when persistence fails', async () => {
    (window.api.settings.setLanguage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Unable to save language'),
    );
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ projectId }: { projectId: string | null }) =>
        projectId === 'project-second'
          ? [
              {
                id: 'session-second',
                projectId,
                title: 'Second project conversation',
                status: 'active',
                activeBranchId: 'branch-second',
                activeDocumentId: 'doc-second',
                archivedAt: null,
                createdAt: '2026-07-29T00:00:00.000Z',
                updatedAt: '2026-07-29T00:00:00.000Z',
              },
            ]
          : [],
    );

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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

  it('does not let a slow active-session request overwrite the archived view', async () => {
    let resolveActiveSessions!: (value: any[]) => void;
    const pendingActiveSessions = new Promise<any[]>((resolve) => {
      resolveActiveSessions = resolve;
    });
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ projectId, status }: { projectId: string | null; status: string }) => {
        if (projectId === null) return [];
        if (status === 'active') return pendingActiveSessions;
        return [
          {
            id: 'session-archived',
            projectId,
            title: 'Archived project session',
            status: 'archived',
            activeBranchId: 'branch-archived',
            activeDocumentId: 'doc-archived',
            archivedAt: '2026-07-30T00:00:00.000Z',
            createdAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z',
          },
        ];
      },
    );

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: 'Fixture' }));
    await user.click(screen.getByRole('button', { name: 'Archived' }));

    expect(
      await screen.findByRole('button', { name: 'Archived project session' }),
    ).toBeInTheDocument();

    resolveActiveSessions([
      {
        id: 'session-stale-active',
        projectId: 'project-1',
        title: 'Stale active session',
        status: 'active',
        activeBranchId: 'branch-active',
        activeDocumentId: 'doc-active',
        archivedAt: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ]);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Stale active session' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Archived project session' })).toBeInTheDocument();
  });

  it('restores the active session buckets when archived loading fails', async () => {
    const activeSession = {
      id: 'session-active-fallback',
      projectId: null,
      title: 'Active fallback session',
      status: 'active',
      activeBranchId: 'branch-active',
      activeDocumentId: 'doc-active',
      archivedAt: null,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      activeSession,
    ]);
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ status }: { status: string }) => {
        if (status === 'archived') throw new Error('Archive list unavailable');
        return [activeSession];
      },
    );

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: 'No Project' }));
    expect(
      (await screen.findAllByRole('button', { name: 'Active fallback session' })).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Archived' }));

    expect(await screen.findByText('Archive list unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getAllByRole('button', { name: 'Active fallback session' }).length,
    ).toBeGreaterThan(0);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

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

  it('starts a project draft from the folder new-session action', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(
      await screen.findByRole('button', { name: 'New Session: Fixture' }),
    );
    await user.type(screen.getByLabelText(/analysis goal/i), 'Draft from project');
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(window.api.codeAnalysis.runTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: undefined,
          projectId: 'project-1',
          goal: 'Draft from project',
        }),
      ),
    );
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    // Sessions should be visible in the left panel
    const sessionButton = await screen.findByRole('button', { name: 'Existing Session' });
    await user.click(sessionButton);

    await waitFor(() =>
      expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith('session-existing'),
    );

    // Turn content should be visible
    expect(await screen.findByText('Startup')).toBeInTheDocument();
  });

  it('highlights annotated text and opens the annotation when its mark is clicked', async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });
    const mockSession = {
      id: 'session-ann',
      title: 'Ann Session',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'turn-1',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const mockBranches = [
      {
        id: 'branch-1',
        sessionId: 'session-ann',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'turn-1',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ];
    const mockTurns = [
      {
        id: 'turn-1',
        sessionId: 'session-ann',
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
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ann-1',
        analysisDocumentId: 'turn-1',
        anchorExactText: 'Startup',
        anchorStartOffset: 2,
        anchorEndOffset: 9,
        question: 'What is startup?',
        status: 'answered',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ]);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Ann Session' }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith('session-ann'),
    );

    // The annotated text is highlighted as a mark in the turn's markdown.
    const marks = document.querySelectorAll('mark[data-annotation-ids]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('Startup');

    // Clicking the mark activates the annotation and expands its sidebar card.
    await user.click(marks[0]);
    const card = screen.getByText('Startup', { selector: 'blockquote' }).closest('article')!;
    await waitFor(() =>
      expect(card.querySelector('[aria-expanded]')).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(card.querySelector('[aria-expanded]')).toHaveFocus();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('scrolls to and focuses the source mark when view source is clicked', async () => {
    // jsdom does not implement scrollIntoView, so inject a mock and delete it
    // when the test is done.
    const scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });

    const mockSession = {
      id: 'session-ann2',
      title: 'Ann Session Two',
      status: 'active',
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'turn-1',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const mockBranches = [
      {
        id: 'branch-1',
        sessionId: 'session-ann2',
        name: 'main',
        parentBranchId: null,
        forkedFromDocumentId: null,
        headDocumentId: 'turn-1',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ];
    const mockTurns = [
      {
        id: 'turn-1',
        sessionId: 'session-ann2',
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
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ann-1',
        analysisDocumentId: 'turn-1',
        anchorExactText: 'Startup',
        anchorStartOffset: 2,
        anchorEndOffset: 9,
        question: 'What is startup?',
        status: 'answered',
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ]);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Ann Session Two' }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith('session-ann2'),
    );

    // Expand the annotation so the "view source" affordance is visible. The
    // real button's visible text matches; the anchor text carries the same
    // label as an aria-label, so match visible text rather than role/name.
    await user.click(document.querySelector('mark[data-annotation-ids]')!);
    await screen.findByText(/view source|查看原文/i);

    await user.click(screen.getByText(/view source|查看原文/i));

    expect(scrollSpy).toHaveBeenCalled();
    expect(document.querySelector('mark[data-annotation-ids]')).toHaveFocus();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

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

  it('archives and restores a session through the active and archived views', async () => {
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

    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
    ]);
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ projectId, status }: { projectId: string | null; status: string }) => {
        if (projectId !== null) return [];
        return status === 'archived' ? [archivedSession] : [mockSession];
      },
    );
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
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(
      await screen.findByRole('button', { name: 'Manage session: Archive Session' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.archiveSession).toHaveBeenCalledWith('session-archive'),
    );
    expect(screen.queryByRole('button', { name: 'Archive Session' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archived' }));
    await waitFor(() =>
      expect(window.api.codeAnalysis.listSessions).toHaveBeenCalledWith({
        projectId: null,
        status: 'archived',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'No Project' }));
    await user.click(
      await screen.findByRole('button', { name: 'Archive Session' }),
    );
    expect(
      screen.getByText('Archived sessions are read-only. Restore this session to continue.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Analysis goal')).not.toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', { name: 'Manage session: Archive Session' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Restore' }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.restoreSession).toHaveBeenCalledWith('session-archive'),
    );
    const projectSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(
      within(projectSection as HTMLElement).queryByRole('button', {
        name: 'Archive Session',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive Session' })).toBeInTheDocument();
    expect(screen.getByLabelText('Analysis goal')).toBeInTheDocument();
  });

  it('renames and permanently deletes a session from the recent list', async () => {
    const mockSession = {
      id: 'session-manage',
      title: 'Original title',
      status: 'active' as const,
      projectId: null,
      activeBranchId: 'branch-1',
      activeDocumentId: 'doc-1',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const adjacentSession = {
      ...mockSession,
      id: 'session-adjacent',
      title: 'Adjacent session',
      activeBranchId: 'branch-2',
      activeDocumentId: 'doc-2',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
      adjacentSession,
    ]);
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      mockSession,
      adjacentSession,
    ]);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);

    await user.click(await screen.findByRole('button', { name: 'Original title' }));
    await user.click(
      screen.getByRole('button', { name: 'Manage session: Original title' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const titleInput = screen.getByRole('textbox', { name: 'Session title' });
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed title{Enter}');

    await waitFor(() =>
      expect(window.api.codeAnalysis.renameSession).toHaveBeenCalledWith({
        sessionId: 'session-manage',
        title: 'Renamed title',
      }),
    );
    expect(screen.getByRole('button', { name: 'Renamed title' })).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Manage session: Renamed title' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete permanently',
      }),
    );

    await waitFor(() =>
      expect(window.api.codeAnalysis.deleteSession).toHaveBeenCalledWith({
        sessionId: 'session-manage',
        confirmed: true,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Renamed title' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjacent session' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('clears the workbench after deleting the only selected session', async () => {
    const onlySession = {
      id: 'session-only',
      title: 'Only session',
      status: 'active' as const,
      projectId: null,
      activeBranchId: 'branch-only',
      activeDocumentId: 'doc-only',
      archivedAt: null,
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      onlySession,
    ]);
    (window.api.codeAnalysis.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([
      onlySession,
    ]);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: 'Only session' }));
    await user.type(screen.getByLabelText('Analysis goal'), 'unsent draft');
    await user.click(
      screen.getByRole('button', { name: 'Manage session: Only session' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete permanently',
      }),
    );

    await waitFor(() =>
      expect(window.api.codeAnalysis.deleteSession).toHaveBeenCalledWith({
        sessionId: 'session-only',
        confirmed: true,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Only session' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Analysis goal')).toHaveValue('');
  });

  it('switches the comment panel when a different assistant document becomes visible', async () => {
    class MockIntersectionObserver {
      static instances: MockIntersectionObserver[] = [];
      readonly targets = new Set<Element>();

      constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
      ) {
        MockIntersectionObserver.instances.push(this);
      }

      observe = (target: Element) => this.targets.add(target);
      unobserve = (target: Element) => this.targets.delete(target);
      disconnect = () => this.targets.clear();
      takeRecords = () => [];

      emit(target: Element) {
        this.callback(
          [{ isIntersecting: true, intersectionRatio: 0.75, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    }

    const originalIntersectionObserver = window.IntersectionObserver;
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: MockIntersectionObserver,
    });

    const session = {
      id: 'session-visible-turn',
      title: 'Visible turns',
      status: 'active' as const,
      projectId: 'project-1',
      activeBranchId: 'branch-1',
      activeDocumentId: 'turn-1',
      archivedAt: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:01:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([session]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session,
      branches: [],
      turns: [
        {
          id: 'turn-1', sessionId: session.id, branchId: 'branch-1', parentDocumentId: null,
          goal: 'First', contentMarkdown: '# First answer', status: 'completed', toolCallCount: 0,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
        },
        {
          id: 'turn-2', sessionId: session.id, branchId: 'branch-1', parentDocumentId: 'turn-1',
          goal: 'Second', contentMarkdown: '# Second answer', status: 'completed', toolCallCount: 0,
          createdAt: session.updatedAt, updatedAt: session.updatedAt,
        },
      ],
    });
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockImplementation(
      async (documentId: string) =>
        documentId === 'turn-2'
          ? [{
              id: 'ann-turn-2', analysisDocumentId: 'turn-2', anchorExactText: 'Second answer',
              selectedText: 'Second answer', question: 'Second question', status: 'answered',
              createdAt: session.updatedAt, updatedAt: session.updatedAt,
            }]
          : [],
    );

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: 'Visible turns' }));
    expect(await screen.findByText('Second answer')).toBeInTheDocument();

    const secondDocument = document.querySelector('[data-analysis-document-id="turn-2"]')!;
    const observer = MockIntersectionObserver.instances.find((item) =>
      item.targets.has(secondDocument),
    )!;
    expect(observer.options?.root).toBe(document.querySelector('[role="log"]')?.closest('section'));
    act(() => observer.emit(secondDocument));

    await waitFor(() =>
      expect(window.api.codeAnalysis.listAnnotations).toHaveBeenLastCalledWith('turn-2'),
    );
    expect(await screen.findByTestId('annotation-delete-ann-turn-2')).toBeInTheDocument();

    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: originalIntersectionObserver,
    });
  });

  it('creates an independent session from the active conversation entry and selects it', async () => {
    const sourceSession = {
      id: 'session-source', title: 'Source conversation', status: 'active' as const,
      projectId: null, activeBranchId: 'branch-source', activeDocumentId: 'turn-source-2',
      archivedAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:01:00.000Z',
    };
    const forkedSession = {
      ...sourceSession,
      id: 'session-forked', title: 'Source conversation · Branch', activeBranchId: 'branch-forked',
      activeDocumentId: 'turn-forked',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sourceSession]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockImplementation(
      async (sessionId: string) => sessionId === sourceSession.id
        ? {
            session: sourceSession,
            branches: [],
            turns: [
              {
                id: 'turn-source-1', sessionId: sourceSession.id, branchId: 'branch-source',
                parentDocumentId: null, goal: 'First source question', contentMarkdown: '# First source answer',
                status: 'completed', toolCallCount: 0, createdAt: sourceSession.createdAt,
                updatedAt: sourceSession.updatedAt,
              },
              {
                id: 'turn-source-2', sessionId: sourceSession.id, branchId: 'branch-source',
                parentDocumentId: 'turn-source-1', goal: 'Second source question', contentMarkdown: '# Second source answer',
                status: 'completed', toolCallCount: 0, createdAt: sourceSession.updatedAt,
                updatedAt: sourceSession.updatedAt,
              },
            ],
          }
        : {
            session: forkedSession,
            branches: [],
            turns: [
              {
                id: 'turn-forked', sessionId: forkedSession.id, branchId: 'branch-forked',
                parentDocumentId: null, goal: 'Forked question', contentMarkdown: '# Forked answer',
                status: 'completed', toolCallCount: 0, createdAt: forkedSession.createdAt,
                updatedAt: forkedSession.updatedAt,
              },
            ],
          },
    );
    (window.api.codeAnalysis.forkSession as ReturnType<typeof vi.fn>).mockResolvedValue(forkedSession);

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: sourceSession.title }));
    await user.click(await screen.findByRole('button', { name: 'Create branch' }));

    expect(window.api.codeAnalysis.forkSession).toHaveBeenCalledWith({
      sessionId: sourceSession.id,
      documentId: sourceSession.activeDocumentId,
    });
    expect(await screen.findByText('Forked answer')).toBeInTheDocument();
    expect(window.api.codeAnalysis.getSession).toHaveBeenCalledWith(forkedSession.id);
  });

  it('creates an independent session from every conversation turn entry', async () => {
    const sourceSession = {
      id: 'session-timeline', title: 'Timeline conversation', status: 'active' as const,
      projectId: null, activeBranchId: 'branch-timeline', activeDocumentId: 'turn-timeline-2',
      archivedAt: null, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:01:00.000Z',
    };
    (window.api.codeAnalysis.listRecentSessions as ReturnType<typeof vi.fn>).mockResolvedValue([sourceSession]);
    (window.api.codeAnalysis.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: sourceSession,
      branches: [],
      turns: [
        {
          id: 'turn-timeline-1', sessionId: sourceSession.id, branchId: 'branch-timeline',
          parentDocumentId: null, goal: 'First timeline question', contentMarkdown: '# First timeline answer',
          status: 'completed', toolCallCount: 0, createdAt: sourceSession.createdAt,
          updatedAt: sourceSession.updatedAt,
        },
        {
          id: 'turn-timeline-2', sessionId: sourceSession.id, branchId: 'branch-timeline',
          parentDocumentId: 'turn-timeline-1', goal: 'Second timeline question', contentMarkdown: '# Second timeline answer',
          status: 'completed', toolCallCount: 0, createdAt: sourceSession.updatedAt,
          updatedAt: sourceSession.updatedAt,
        },
      ],
    });

    const user = userEvent.setup();
    render(<ThemeProvider><CodeAnalysisWorkbench /></ThemeProvider>);
    await user.click(await screen.findByRole('button', { name: sourceSession.title }));
    await user.click((await screen.findAllByRole('button', { name: 'Branch from here' }))[0]);

    expect(window.api.codeAnalysis.forkSession).toHaveBeenCalledWith({
      sessionId: sourceSession.id,
      documentId: 'turn-timeline-1',
    });
  });
});
