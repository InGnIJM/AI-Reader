import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodeAnalysisWorkbench from '../CodeAnalysisWorkbench';

describe('CodeAnalysisWorkbench', () => {
  beforeEach(() => {
    (window as any).api = {
      codeAnalysis: {
        createProject: vi.fn(async () => ({ id: 'project-1', name: 'Fixture', rootPathHash: 'hash' })),
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
        replyToAnnotation: vi.fn(async () => []),
        exportMarkdown: vi.fn(async () => '# Export'),
        exportJson: vi.fn(async () => ({ type: 'code-analysis-document' })),
      },
      dialog: {
        openDirectory: vi.fn(async () => ({ canceled: false, filePaths: ['E:/fixture'] })),
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
  });
});
