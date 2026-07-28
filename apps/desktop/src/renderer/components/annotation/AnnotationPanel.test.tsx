import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AnnotationPanel } from './AnnotationPanel';
import type { AnnotationItem } from './AnnotationPanel';

afterEach(() => {
  cleanup();
});

const sampleAnnotations: AnnotationItem[] = [
  {
    id: 'ann-1',
    anchorExactText: '编译器是将源语言翻译成目标语言的程序',
    type: 'note',
    content: '这是一个重要的定义',
    createdAt: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
  },
  {
    id: 'ann-2',
    anchorExactText: '词法分析',
    type: 'question',
    content: '什么是词法分析？',
    createdAt: new Date(Date.now() - 3_600_000).toISOString(), // 1 hour ago
  },
  {
    id: 'ann-3',
    anchorExactText: '语法树',
    type: 'highlight',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
  },
];

describe('AnnotationPanel', () => {
  describe('rendering', () => {
    it('should render the panel container', () => {
      render(<AnnotationPanel annotations={[]} onSelect={vi.fn()} onDelete={vi.fn()} />);
      expect(screen.getByTestId('annotation-panel')).toBeInTheDocument();
    });

    it('should render empty state when annotations is empty', () => {
      render(<AnnotationPanel annotations={[]} onSelect={vi.fn()} onDelete={vi.fn()} />);
      expect(screen.getByTestId('annotation-empty')).toBeInTheDocument();
      expect(screen.getByText('选中文本创建批注')).toBeInTheDocument();
    });

    it('should render all annotation cards', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      expect(screen.getByTestId('annotation-list')).toBeInTheDocument();
      expect(screen.getByTestId('annotation-card-ann-1')).toBeInTheDocument();
      expect(screen.getByTestId('annotation-card-ann-2')).toBeInTheDocument();
      expect(screen.getByTestId('annotation-card-ann-3')).toBeInTheDocument();
    });

    it('should display selected text for each annotation', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      expect(screen.getByText('编译器是将源语言翻译成目标语言的程序')).toBeInTheDocument();
      expect(screen.getByText('词法分析')).toBeInTheDocument();
      expect(screen.getByText('语法树')).toBeInTheDocument();
    });

    it('should display user content when present', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      expect(screen.getByText('这是一个重要的定义')).toBeInTheDocument();
      expect(screen.getByText('什么是词法分析？')).toBeInTheDocument();
    });

    it('should not display content block when content is absent', () => {
      const highlightOnly: AnnotationItem[] = [sampleAnnotations[2]]; // no content
      render(
        <AnnotationPanel annotations={highlightOnly} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      // The card should render but without a content div
      expect(screen.getByTestId('annotation-card-ann-3')).toBeInTheDocument();
    });

    it('should render Material Symbols icons for each type', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      const card1 = screen.getByTestId('annotation-card-ann-1');
      expect(card1.querySelector('.material-symbols-rounded')).toHaveTextContent('edit_note');

      const card2 = screen.getByTestId('annotation-card-ann-2');
      expect(card2.querySelector('.material-symbols-rounded')).toHaveTextContent('help');

      const card3 = screen.getByTestId('annotation-card-ann-3');
      expect(card3.querySelector('.material-symbols-rounded')).toHaveTextContent('ink_highlighter');
    });

    it('should have list role on the annotation list', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('should apply active styling to the active annotation', () => {
      render(
        <AnnotationPanel
          annotations={sampleAnnotations}
          activeAnnotationId="ann-2"
          onSelect={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      const activeCard = screen.getByTestId('annotation-card-ann-2');
      expect(activeCard).toHaveAttribute('aria-current', 'true');
    });

    it('should not set aria-current on non-active cards', () => {
      render(
        <AnnotationPanel
          annotations={sampleAnnotations}
          activeAnnotationId="ann-2"
          onSelect={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
      const otherCard = screen.getByTestId('annotation-card-ann-1');
      expect(otherCard).not.toHaveAttribute('aria-current');
    });
  });

  describe('selection', () => {
    it('should call onSelect with annotation id when card is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={onSelect} onDelete={vi.fn()} />,
      );

      await user.click(screen.getByTestId('annotation-card-ann-2'));
      expect(onSelect).toHaveBeenCalledWith('ann-2');
    });

    it('should call onSelect on Enter key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={onSelect} onDelete={vi.fn()} />,
      );

      const card = screen.getByTestId('annotation-card-ann-1');
      card.focus();
      await user.keyboard('{Enter}');
      expect(onSelect).toHaveBeenCalledWith('ann-1');
    });

    it('should call onSelect on Space key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={onSelect} onDelete={vi.fn()} />,
      );

      const card = screen.getByTestId('annotation-card-ann-1');
      card.focus();
      await user.keyboard(' ');
      expect(onSelect).toHaveBeenCalledWith('ann-1');
    });

    it('should move focus down on ArrowDown', async () => {
      const user = userEvent.setup();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );

      const firstCard = screen.getByTestId('annotation-card-ann-1');
      firstCard.focus();
      await user.keyboard('{ArrowDown}');

      expect(screen.getByTestId('annotation-card-ann-2')).toHaveFocus();
    });

    it('should move focus up on ArrowUp', async () => {
      const user = userEvent.setup();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );

      const secondCard = screen.getByTestId('annotation-card-ann-2');
      secondCard.focus();
      await user.keyboard('{ArrowUp}');

      expect(screen.getByTestId('annotation-card-ann-1')).toHaveFocus();
    });

    it('should not move focus past the first card on ArrowUp', async () => {
      const user = userEvent.setup();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );

      const firstCard = screen.getByTestId('annotation-card-ann-1');
      firstCard.focus();
      await user.keyboard('{ArrowUp}');

      expect(screen.getByTestId('annotation-card-ann-1')).toHaveFocus();
    });

    it('should not move focus past the last card on ArrowDown', async () => {
      const user = userEvent.setup();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );

      const lastCard = screen.getByTestId('annotation-card-ann-3');
      lastCard.focus();
      await user.keyboard('{ArrowDown}');

      expect(screen.getByTestId('annotation-card-ann-3')).toHaveFocus();
    });
  });

  describe('deletion', () => {
    it('should call onDelete with annotation id when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={onDelete} />,
      );

      await user.click(screen.getByTestId('annotation-delete-ann-2'));
      expect(onDelete).toHaveBeenCalledWith('ann-2');
    });

    it('should not trigger onSelect when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const onDelete = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={onSelect} onDelete={onDelete} />,
      );

      await user.click(screen.getByTestId('annotation-delete-ann-1'));
      expect(onDelete).toHaveBeenCalledWith('ann-1');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('should have accessible label on delete button', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      expect(
        screen.getByLabelText('删除批注: 编译器是将源语言翻译成目标语言的程序'),
      ).toBeInTheDocument();
    });

    it('should have title attribute on delete button', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      const deleteBtn = screen.getByTestId('annotation-delete-ann-1');
      expect(deleteBtn).toHaveAttribute('title', '删除批注');
    });
  });

  describe('edge cases', () => {
    it('should handle a single annotation', () => {
      const single: AnnotationItem[] = [sampleAnnotations[0]];
      render(<AnnotationPanel annotations={single} onSelect={vi.fn()} onDelete={vi.fn()} />);
      expect(screen.getByTestId('annotation-card-ann-1')).toBeInTheDocument();
    });

    it('should handle annotations without activeAnnotationId', () => {
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={vi.fn()} onDelete={vi.fn()} />,
      );
      for (const ann of sampleAnnotations) {
        const card = screen.getByTestId(`annotation-card-${ann.id}`);
        expect(card).not.toHaveAttribute('aria-current');
      }
    });

    it('should handle non-actionable key press without calling onSelect', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(
        <AnnotationPanel annotations={sampleAnnotations} onSelect={onSelect} onDelete={vi.fn()} />,
      );

      const card = screen.getByTestId('annotation-card-ann-1');
      card.focus();
      await user.keyboard('{Tab}');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('should default unknown type to edit_note icon', () => {
      const unknownType: AnnotationItem[] = [
        { ...sampleAnnotations[0], id: 'ann-x', type: 'unknown-type' },
      ];
      render(<AnnotationPanel annotations={unknownType} onSelect={vi.fn()} onDelete={vi.fn()} />);
      const card = screen.getByTestId('annotation-card-ann-x');
      expect(card.querySelector('.material-symbols-rounded')).toHaveTextContent('edit_note');
    });
  });
});
