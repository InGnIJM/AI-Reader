import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReplyActions } from '../ReplyActions';

const labels = {
  copy: 'Copy reply',
  checkout: 'Go back to this reply',
  fork: 'Branch from this reply',
  export: 'Export reply',
  exportMarkdown: 'Export Markdown',
  exportJson: 'Export JSON',
};

describe('ReplyActions', () => {
  it('emits every completed-reply action with the chosen export format', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onCheckout = vi.fn();
    const onFork = vi.fn();
    const onExport = vi.fn();

    render(
      <ReplyActions labels={labels} onCopy={onCopy} onCheckout={onCheckout} onFork={onFork} onExport={onExport} />,
    );

    await user.click(screen.getByRole('button', { name: labels.copy }));
    await user.click(screen.getByRole('button', { name: labels.checkout }));
    await user.click(screen.getByRole('button', { name: labels.fork }));
    await user.click(screen.getByRole('button', { name: labels.export }));
    await user.click(screen.getByRole('menuitem', { name: labels.exportJson }));

    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCheckout).toHaveBeenCalledOnce();
    expect(onFork).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledWith('json');
  });

  it('disables every action while the reply cannot be operated', () => {
    render(<ReplyActions disabled labels={labels} onCopy={vi.fn()} onCheckout={vi.fn()} onFork={vi.fn()} onExport={vi.fn()} />);

    for (const label of [labels.copy, labels.checkout, labels.fork, labels.export]) {
      expect(screen.getAllByRole('button', { name: label }).at(-1)).toBeDisabled();
    }
  });
});
