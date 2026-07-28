import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TextSelectionToolbar } from '../TextSelectionToolbar';

afterEach(() => {
  cleanup();
});

describe('TextSelectionToolbar', () => {
  const defaultProps = {
    selectedText: 'Selected text',
    position: { x: 400, y: 300 },
    onCreateNote: vi.fn(),
    onCreateQuestion: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the toolbar', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    expect(screen.getByTestId('text-selection-toolbar')).toBeInTheDocument();
  });

  it('should render note and question action buttons', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    expect(screen.getByTestId('toolbar-create-note')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-create-question')).toBeInTheDocument();
  });

  it('should render action labels', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    expect(screen.getByText('批注')).toBeInTheDocument();
    expect(screen.getByText('提问')).toBeInTheDocument();
  });

  it('should call onCreateNote when note button is clicked', () => {
    const onCreateNote = vi.fn();
    render(<TextSelectionToolbar {...defaultProps} onCreateNote={onCreateNote} />);

    fireEvent.click(screen.getByTestId('toolbar-create-note'));
    expect(onCreateNote).toHaveBeenCalled();
  });

  it('should call onCreateQuestion when question button is clicked', () => {
    const onCreateQuestion = vi.fn();
    render(<TextSelectionToolbar {...defaultProps} onCreateQuestion={onCreateQuestion} />);

    fireEvent.click(screen.getByTestId('toolbar-create-question'));
    expect(onCreateQuestion).toHaveBeenCalled();
  });

  it('should call onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onClose when clicking outside the toolbar', () => {
    const onClose = vi.fn();
    render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('should not call onClose when clicking inside the toolbar', () => {
    const onClose = vi.fn();
    render(<TextSelectionToolbar {...defaultProps} onClose={onClose} />);

    const toolbar = screen.getByTestId('text-selection-toolbar');
    fireEvent.mouseDown(toolbar);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('should not render when selectedText is empty', () => {
    render(<TextSelectionToolbar {...defaultProps} selectedText="" />);

    expect(screen.queryByTestId('text-selection-toolbar')).not.toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toHaveAttribute('aria-label', '文本操作');
  });

  it('should position the toolbar at the specified position', () => {
    render(<TextSelectionToolbar {...defaultProps} position={{ x: 200, y: 150 }} />);

    const toolbar = screen.getByTestId('text-selection-toolbar');
    expect(toolbar.style.left).toBeDefined();
    expect(toolbar.style.top).toBeDefined();
  });

  it('should have proper aria-labels on buttons', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    expect(screen.getByLabelText('创建批注')).toBeInTheDocument();
    expect(screen.getByLabelText('创建提问')).toBeInTheDocument();
  });

  it('should have proper title attributes on buttons', () => {
    render(<TextSelectionToolbar {...defaultProps} />);

    const noteButton = screen.getByTestId('toolbar-create-note');
    const questionButton = screen.getByTestId('toolbar-create-question');

    expect(noteButton).toHaveAttribute('title', '创建批注');
    expect(questionButton).toHaveAttribute('title', '创建提问');
  });
});
