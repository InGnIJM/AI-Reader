import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnalysisPromptBox } from '../AnalysisPromptBox';

describe('AnalysisPromptBox', () => {
  it('uses an accessible icon-only send action and submits from the keyboard', () => {
    const onSubmit = vi.fn();
    render(
      <AnalysisPromptBox
        value="Explain the startup flow"
        labels={{ ariaLabel: 'Analysis goal', placeholder: 'Ask a question', submit: 'Send' }}
        onChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Send' });
    expect(submit).toHaveTextContent('send');
    fireEvent.keyDown(screen.getByLabelText('Analysis goal'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('keeps the send action disabled for empty or disabled prompts', () => {
    const { rerender } = render(
      <AnalysisPromptBox value="  " onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();

    rerender(<AnalysisPromptBox value="Ready" disabled onChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
});
