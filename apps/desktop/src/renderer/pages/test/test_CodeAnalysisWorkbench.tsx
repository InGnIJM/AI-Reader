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

    await waitFor(() => expect(screen.getByText('Startup')).toBeInTheDocument());
    expect(screen.getByText(/listFiles/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /export md/i }));
    await user.click(screen.getByRole('button', { name: /export json/i }));
    expect(window.api.codeAnalysis.exportMarkdown).toHaveBeenCalledWith('doc-1');
    expect(window.api.codeAnalysis.exportJson).toHaveBeenCalledWith('doc-1');
  });

  it('shows the submitted goal in the conversation before analysis finishes', async () => {
    let resolveRun!: (value: {
      id: string;
      projectId: string;
      goal: string;
      contentMarkdown: string;
      status: string;
      toolCallCount: number;
    }) => void;
    const pendingRun = new Promise<Parameters<typeof resolveRun>[0]>((resolve) => {
      resolveRun = resolve;
    });
    (window.api.codeAnalysis.run as ReturnType<typeof vi.fn>).mockReturnValue(pendingRun);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    const prompt = screen.getByLabelText(/analysis goal/i);
    await user.type(prompt, 'Explain the startup flow');
    await user.keyboard('{Enter}');

    const userMessage = screen.getByRole('article', { name: /you/i });
    expect(userMessage).toHaveTextContent('Explain the startup flow');
    expect(prompt).toHaveValue('');
    expect(screen.getByText('Analyzing project...')).toBeInTheDocument();

    resolveRun({
      id: 'doc-2',
      projectId: 'project-1',
      goal: 'Explain the startup flow',
      contentMarkdown: '# Startup flow',
      status: 'completed',
      toolCallCount: 1,
    });
    await waitFor(() => expect(screen.getByText('Startup flow')).toBeInTheDocument());
  });

  it('creates separate selectable records for subsequent analyses', async () => {
    const run = window.api.codeAnalysis.run as ReturnType<typeof vi.fn>;
    run
      .mockResolvedValueOnce({
        id: 'doc-first',
        projectId: 'project-1',
        goal: 'First analysis',
        contentMarkdown: '# First answer',
        status: 'completed',
        toolCallCount: 1,
      })
      .mockResolvedValueOnce({
        id: 'doc-second',
        projectId: 'project-1',
        goal: 'Second analysis',
        contentMarkdown: '# Second answer',
        status: 'completed',
        toolCallCount: 1,
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

    expect(screen.queryByText('First answer')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'First analysis' }));

    await waitFor(() =>
      expect(window.api.codeAnalysis.listAnnotations).toHaveBeenLastCalledWith('doc-first'),
    );
    expect(window.api.codeAnalysis.listTraces).toHaveBeenLastCalledWith('doc-first');
    expect(screen.getByText('First answer')).toBeInTheDocument();
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
          analysisDocumentId: 'doc-1',
          anchorExactText: 'IPC',
          question: 'What is IPC?',
          status: 'answered',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'ann-1',
          analysisDocumentId: 'doc-1',
          anchorExactText: 'Startup',
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
    const startup = await screen.findByText('Startup');

    const range = document.createRange();
    range.selectNodeContents(startup);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Startup',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(startup);

    await user.type(screen.getByLabelText(/comment question/i), 'Explain this');
    await user.click(screen.getByRole('button', { name: /^comment$/i }));

    expect(await screen.findByText('pnpm')).toBeInTheDocument();
    expect(screen.getByText(/manages packages across this monorepo/i)).toBeInTheDocument();
    expect(screen.getByText('Existing persisted reply.')).toBeInTheDocument();
    expect(screen.getAllByText('answered')).toHaveLength(2);
  });

  it('restores a selected conversation and its persisted annotation reply', async () => {
    (window.api.codeAnalysis.listDocuments as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'doc-history',
        projectId: 'project-1',
        goal: 'What is pnpm monorepo?',
        contentMarkdown: '# pnpm monorepo\n\nA workspace with multiple packages.',
        status: 'completed',
        toolCallCount: 2,
        createdAt: '2026-07-29T10:00:00.000Z',
        updatedAt: '2026-07-29T10:01:00.000Z',
      },
    ]);
    (window.api.codeAnalysis.listAnnotations as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'ann-history',
        analysisDocumentId: 'doc-history',
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

    await user.click(await screen.findByRole('button', { name: 'Fixture' }));
    await user.click(await screen.findByRole('button', { name: /what is pnpm monorepo/i }));

    expect(await screen.findByRole('heading', { name: 'pnpm monorepo' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: /you/i })).toHaveTextContent(
      'What is pnpm monorepo?',
    );
    expect(screen.getByText(/manages multiple packages in one repository/i)).toBeInTheDocument();
    expect(window.api.codeAnalysis.listTraces).toHaveBeenCalledWith('doc-history');
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
    (window.api.codeAnalysis.run as ReturnType<typeof vi.fn>).mockRejectedValue(
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
          analysisDocumentId: 'doc-1',
          anchorExactText: 'Startup',
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
    const startup = await screen.findByText('Startup');
    const range = document.createRange();
    range.selectNodeContents(startup);
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Startup',
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection);
    fireEvent.mouseUp(startup);
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

  it('does not let a completed analysis overwrite a project selected while it was running', async () => {
    let resolveRun!: (value: any) => void;
    const pendingRun = new Promise<any>((resolve) => {
      resolveRun = resolve;
    });
    (window.api.codeAnalysis.listProjects as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'project-second', name: 'Second project', rootPathHash: 'second' },
    ]);
    (window.api.codeAnalysis.run as ReturnType<typeof vi.fn>).mockReturnValue(pendingRun);

    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);
    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Slow analysis');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Second project' }));

    resolveRun({
      id: 'doc-stale',
      projectId: 'project-1',
      goal: 'Slow analysis',
      contentMarkdown: '# Stale result',
      status: 'completed',
      toolCallCount: 0,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    });

    await waitFor(() => expect(screen.queryByText('Stale result')).not.toBeInTheDocument());
    expect(window.api.codeAnalysis.listTraces).not.toHaveBeenCalledWith('doc-stale');
  });
});
