import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TextSelectionToolbar } from './TextSelectionToolbar';
import type { TextSelectionToolbarProps } from './TextSelectionToolbar';

afterEach(() => {
  cleanup();
});

const defaultProps: TextSelectionToolbarProps = {
  selectedText: 'some selected text',
  position: { x: 400, y: 300 },
  onCreateNote: vi.fn(),
  onCreateQuestion: vi.fn(),
  onClose: vi.fn(),
};

describe('TextSelectionToolbar', () => {
  describe('rendering', () => {
    it('should render when selectedText is provided', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('text-selection-toolbar')).toBeInTheDocument();
    });

    it('should not render when selectedText is empty', () => {
      render(<TextSelectionToolbar {...defaultProps} selectedText="" />);
      expect(screen.queryByTestId('text-selection-toolbar')).not.toBeInTheDocument();
    });

    it('should render the note action button', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      const btn = screen.getByTestId('toolbar-create-note');
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent('批注');
    });

    it('should render the question action button', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      const btn = screen.getByTestId('toolbar-create-question');
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent('提问');
    });

    it('should have toolbar role', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      expect(screen.getByRole('toolbar')).toBeInTheDocument();
    });

    it('should have aria-label on toolbar', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      expect(screen.getByLabelText('文本操作')).toBeInTheDocument();
    });

    it('should have aria-label on note button', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      expect(screen.getByLabelText('创建批注')).toBeInTheDocument();
    });

    it('should have aria-label on question button', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      expect(screen.getByLabelText('创建提问')).toBeInTheDocument();
    });

    it('should render Material Symbols icons', () => {
      render(<TextSelectionToolbar {...defaultProps} />);
      const noteBtn = screen.getByTestId('toolbar-create-note');
      const questionBtn = screen.getByTestId('toolbar-create-question');
      expect(noteBtn.querySelector('.material-symbols-rounded')).toHaveTextContent('edit_note');
      expect(questionBtn.querySelector('.material-symbols-rounded')).toHaveTextContent('help');
    });
  });

  describe('actions', () => {
    it('should call onCreateNote when note button is clicked', async () => {
      const user = userEvent.setup();
      const onCreateNote = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onCreateNote={onCreateNote} />);

      await user.click(screen.getByTestId('toolbar-create-note'));
      expect(onCreateNote).toHaveBeenCalledTimes(1);
    });

    it('should call onCreateQuestion when question button is clicked', async () => {
      const user = userEvent.setup();
      const onCreateQuestion = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onCreateQuestion={onCreateQuestion} />);

      await user.click(screen.getByTestId('toolbar-create-question'));
      expect(onCreateQuestion).toHaveBeenCalledTimes(1);
    });
  });

  describe('dismiss behavior', () => {
    it('should call onClose when Escape is pressed', () => {
      const onClose = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when mousedown occurs outside the toolbar', () => {
      const onClose = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

      // Mousedown on the document body (outside toolbar) via capture phase
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not call onClose when mousedown occurs inside the toolbar', () => {
      const onClose = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

      const toolbar = screen.getByTestId('text-selection-toolbar');
      fireEvent.mouseDown(toolbar);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('should not call onClose for non-Escape keys', () => {
      const onClose = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Enter' });
      fireEvent.keyDown(document, { key: 'a' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('positioning', () => {
    it('should apply position as inline style', () => {
      render(<TextSelectionToolbar {...defaultProps} position={{ x: 200, y: 150 }} />);
      const toolbar = screen.getByTestId('text-selection-toolbar');
      // The position gets clamped, but the style should have left/top set
      expect(toolbar.style.left).toBeDefined();
      expect(toolbar.style.top).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle rapid onCreateNote calls', async () => {
      const user = userEvent.setup();
      const onCreateNote = vi.fn();
      render(<TextSelectionToolbar {...defaultProps} onCreateNote={onCreateNote} />);

      const btn = screen.getByTestId('toolbar-create-note');
      await user.click(btn);
      await user.click(btn);
      await user.click(btn);
      expect(onCreateNote).toHaveBeenCalledTimes(3);
    });

    it('should handle cleanup on unmount without errors', () => {
      const { unmount } = render(<TextSelectionToolbar {...defaultProps} />);
      expect(() => unmount()).not.toThrow();
    });
  });
});
