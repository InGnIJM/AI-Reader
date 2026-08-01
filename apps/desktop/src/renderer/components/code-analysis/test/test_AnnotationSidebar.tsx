import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnnotationSidebar } from '../AnnotationSidebar';
import type { AnalysisAnnotationItem } from '../AnnotationSidebar';

afterEach(() => {
  cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAnnotation(overrides: Partial<AnalysisAnnotationItem> = {}): AnalysisAnnotationItem {
  return {
    id: 'ann-1',
    anchorExactText: 'selected text',
    question: 'What does this mean?',
    status: 'open',
    ...overrides,
  };
}

const statusLabels: Record<string, string> = {
  open: '待解答',
  resolved: '已解答',
};

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const defaults = {
    annotations: [],
    statusLabels,
  };
  return render(<AnnotationSidebar {...defaults} {...overrides} />);
}

// ── Empty State ──────────────────────────────────────────────────────────────

describe('AnnotationSidebar empty state', () => {
  it('should show default empty label when no annotations', () => {
    render(<AnnotationSidebar annotations={[]} />);
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });

  it('should show custom empty label when provided', () => {
    render(<AnnotationSidebar annotations={[]} emptyLabel="No annotations here." />);
    expect(screen.getByText('No annotations here.')).toBeInTheDocument();
  });
});

// ── Collapsible: Active Annotation Auto-Expanded ─────────────────────────────

describe('AnnotationSidebar active annotation auto-expanded', () => {
  it('should expand the annotation matching activeAnnotationId', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'first text' }),
      makeAnnotation({ id: 'ann-2', anchorExactText: 'second text' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    // Active annotation should be expanded: question and AI reply visible
    const expandedItem = screen.getByText('first text').closest('article')!;
    expect(expandedItem.querySelector('[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
  });

  it('should not expand non-active annotations', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'first text' }),
      makeAnnotation({ id: 'ann-2', anchorExactText: 'second text' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    const collapsedItem = screen.getByText('second text').closest('article')!;
    expect(collapsedItem.querySelector('[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  });

  it('scrolls the activated annotation card to its beginning', () => {
    const annotations = [makeAnnotation({ id: 'ann-scroll', anchorExactText: 'scroll target' })];
    const { rerender } = renderSidebar({ annotations });
    const card = screen.getByText('scroll target').closest('article')!;
    const scrollIntoView = vi.fn();
    Object.assign(card, { scrollIntoView });

    rerender(<AnnotationSidebar annotations={annotations} activeAnnotationId="ann-scroll" />);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  });
});

// ── Collapsible: Default All Collapsed When No Active ────────────────────────

describe('AnnotationSidebar default collapsed state', () => {
  it('should collapse all annotations when no activeAnnotationId', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'first text' }),
      makeAnnotation({ id: 'ann-2', anchorExactText: 'second text' }),
    ];

    renderSidebar({ annotations });

    const items = screen.getAllByRole('article');
    for (const item of items) {
      expect(item.querySelector('[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

// ── Collapsible: Manual Toggle ───────────────────────────────────────────────

describe('AnnotationSidebar manual toggle', () => {
  it('should expand a collapsed annotation when header is clicked', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'click me text' }),
    ];

    renderSidebar({ annotations });

    const header = screen.getByText('click me text').closest('[aria-expanded]')!;
    expect(header).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('should collapse an expanded annotation when header is clicked again', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'toggle text' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    const header = screen.getByText('toggle text').closest('[aria-expanded]')!;
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  it('should keep a manually collapsed answered annotation collapsed on updates', () => {
    const answered = makeAnnotation({
      id: 'ann-answered',
      anchorExactText: 'answered text',
      status: 'answered',
      messages: [{ id: 'm1', role: 'assistant', content: 'AI reply' }],
    });

    const { rerender } = render(
      <AnnotationSidebar annotations={[answered]} />,
    );

    // Answered annotations auto-expand on first appearance.
    const header = screen.getByText('answered text').closest('[aria-expanded]')!;
    expect(header).toHaveAttribute('aria-expanded', 'true');

    // Manually collapse it.
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');

    // A later annotations update must not reopen it.
    rerender(
      <AnnotationSidebar
        annotations={[answered, makeAnnotation({ id: 'ann-2', anchorExactText: 'other text' })]}
      />,
    );
    const headerAfter = screen.getByText('answered text').closest('[aria-expanded]')!;
    expect(headerAfter).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps an answered card collapsed when it becomes active after the first collapse', () => {
    const answered = makeAnnotation({
      id: 'ann-first-collapse',
      anchorExactText: 'first collapse text',
      status: 'answered',
      messages: [{ id: 'm1', role: 'assistant', content: 'AI reply' }],
    });
    const { rerender } = render(<AnnotationSidebar annotations={[answered]} />);

    const header = screen.getByText('first collapse text').closest('[aria-expanded]')!;
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    rerender(<AnnotationSidebar annotations={[answered]} activeAnnotationId={answered.id} />);

    expect(screen.getByText('first collapse text').closest('[aria-expanded]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

// ── Collapsed Header Content ─────────────────────────────────────────────────

describe('AnnotationSidebar collapsed header', () => {
  it('should show anchor text summary in collapsed header', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', anchorExactText: 'important selection' }),
    ];

    renderSidebar({ annotations });

    expect(screen.getByText('important selection')).toBeInTheDocument();
  });

  it('should show status label in collapsed header', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', status: 'open' }),
    ];

    renderSidebar({ annotations });

    expect(screen.getByText('待解答')).toBeInTheDocument();
  });

  it('should fall back to raw status when no label mapping', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', status: 'custom-status' }),
    ];

    renderSidebar({ annotations, statusLabels: {} });

    expect(screen.getByText('custom-status')).toBeInTheDocument();
  });
});

// ── Expanded Content ─────────────────────────────────────────────────────────

describe('AnnotationSidebar expanded content', () => {
  it('should show question when expanded', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1', question: 'Why is this important?' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    expect(screen.getByText('Why is this important?')).toBeInTheDocument();
  });

  it('should show AI assistant replies when expanded', () => {
    const annotations = [
      makeAnnotation({
        id: 'ann-1',
        messages: [
          { id: 'msg-1', role: 'user', content: 'My question' },
          { id: 'msg-2', role: 'assistant', content: 'AI answer here' },
        ],
      }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    expect(screen.getByText('AI answer here')).toBeInTheDocument();
  });

  it('should hide content when collapsed', () => {
    const annotations = [
      makeAnnotation({
        id: 'ann-1',
        question: 'Hidden question',
        messages: [{ id: 'msg-1', role: 'assistant', content: 'Hidden answer' }],
      }),
    ];

    renderSidebar({ annotations });

    expect(screen.queryByText('Hidden question')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden answer')).not.toBeInTheDocument();
  });
});

// ── View Source ──────────────────────────────────────────────────────────────

describe('AnnotationSidebar view source', () => {
  it('should show "View Source" link when expanded and onViewSource provided', () => {
    const onViewSource = vi.fn();
    const annotations = [
      makeAnnotation({ id: 'ann-1' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1', onViewSource });

    const link = screen.getByText(/view source|查看原文/i);
    expect(link).toBeInTheDocument();
  });

  it('should call onViewSource with annotation id when link is clicked', () => {
    const onViewSource = vi.fn();
    const annotations = [
      makeAnnotation({ id: 'ann-42' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-42', onViewSource });

    fireEvent.click(screen.getByText(/view source|查看原文/i));
    expect(onViewSource).toHaveBeenCalledWith('ann-42');
  });

  it('should not show "View Source" link when onViewSource is not provided', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    expect(screen.queryByText(/view source|查看原文/i)).not.toBeInTheDocument();
  });

  it('should call onViewSource when the anchor text is clicked without toggling expansion', () => {
    const onViewSource = vi.fn();
    const annotations = [
      makeAnnotation({ id: 'ann-5', anchorExactText: 'click anchor text' }),
    ];

    renderSidebar({ annotations, onViewSource });

    fireEvent.click(screen.getByText('click anchor text'));

    expect(onViewSource).toHaveBeenCalledWith('ann-5');
    const item = screen.getByText('click anchor text').closest('article')!;
    expect(item.querySelector('[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  });

  it('should render a custom viewSourceLabel when provided', () => {
    const onViewSource = vi.fn();
    const annotations = [
      makeAnnotation({ id: 'ann-1' }),
    ];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1', onViewSource, viewSourceLabel: 'Jump' });

    expect(screen.getByText('Jump')).toBeInTheDocument();
  });
});

// ── onActivate Callback ──────────────────────────────────────────────────────

describe('AnnotationSidebar onActivate callback', () => {
  it('should call onActivate when an annotation header is clicked', () => {
    const onActivate = vi.fn();
    const annotations = [
      makeAnnotation({ id: 'ann-7', anchorExactText: 'activate me' }),
    ];

    renderSidebar({ annotations, onActivate });

    fireEvent.click(screen.getByText('activate me'));
    expect(onActivate).toHaveBeenCalledWith('ann-7');
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('AnnotationSidebar accessibility', () => {
  it('should render aria-expanded on each annotation toggle', () => {
    const annotations = [
      makeAnnotation({ id: 'ann-1' }),
      makeAnnotation({ id: 'ann-2' }),
    ];

    renderSidebar({ annotations });

    const toggles = screen.getAllByRole('article').map(
      (article) => article.querySelector('[aria-expanded]'),
    );

    for (const toggle of toggles) {
      expect(toggle).not.toBeNull();
      expect(toggle).toHaveAttribute('aria-expanded');
    }
  });
});

// ── Delete ───────────────────────────────────────────────────────────────────

describe('AnnotationSidebar delete', () => {
  it('renders a labelled destructive action instead of an icon-only delete control', () => {
    const annotations = [makeAnnotation({ id: 'ann-1' })];

    renderSidebar({ annotations, onDelete: vi.fn() });

    const deleteButton = screen.getByRole('button', { name: 'Delete' });
    expect(deleteButton).toHaveTextContent('Delete');
    expect(deleteButton).toHaveAttribute('title', 'Delete');
    expect(deleteButton.querySelector('.material-symbols-rounded')).toHaveTextContent(
      'delete_outline',
    );
  });

  it('requires confirmation before deleting an annotation', () => {
    const onDelete = vi.fn();
    const annotations = [makeAnnotation({ id: 'ann-1' })];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1', onDelete });

    fireEvent.click(screen.getByTestId('annotation-delete-ann-1'));
    expect(onDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(onDelete).toHaveBeenCalledWith('ann-1');
    expect(dialog).not.toBeInTheDocument();
  });

  it('should not render the delete button when onDelete is not provided', () => {
    const annotations = [makeAnnotation({ id: 'ann-1' })];

    renderSidebar({ annotations, activeAnnotationId: 'ann-1' });

    expect(screen.queryByTestId('annotation-delete-ann-1')).not.toBeInTheDocument();
  });
});
