import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnnotationPanel } from '../AnnotationPanel';
import type { AnnotationItem } from '../AnnotationPanel';

afterEach(() => {
  cleanup();
});

describe('AnnotationPanel', () => {
  const mockAnnotations: AnnotationItem[] = [
    {
      id: 'ann-1',
      anchorExactText: 'Test content',
      type: 'note',
      content: 'This is a note',
      createdAt: '2025-01-15T10:30:00.000Z',
    },
    {
      id: 'ann-2',
      anchorExactText: 'important',
      type: 'question',
      content: 'What does this mean?',
      createdAt: '2025-01-15T11:00:00.000Z',
    },
    {
      id: 'ann-3',
      anchorExactText: 'highlighted',
      type: 'highlight',
      createdAt: '2025-01-15T12:00:00.000Z',
    },
  ];

  it('should render all annotations', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
    expect(screen.getByText('important')).toBeInTheDocument();
    expect(screen.getByText('highlighted')).toBeInTheDocument();
  });

  it('should render annotation content when present', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('This is a note')).toBeInTheDocument();
    expect(screen.getByText('What does this mean?')).toBeInTheDocument();
  });

  it('should not render content when annotation has no content', () => {
    const highlightOnly: AnnotationItem[] = [mockAnnotations[2]];
    render(
      <AnnotationPanel
        annotations={highlightOnly}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('highlighted')).toBeInTheDocument();
  });

  it('should call onSelect when annotation card is clicked', () => {
    const onSelect = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('annotation-card-ann-1'));
    expect(onSelect).toHaveBeenCalledWith('ann-1');
  });

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );

    const deleteButton = screen.getByTestId('annotation-delete-ann-1');
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('ann-1');
  });

  it('should stop propagation when delete is clicked', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={onSelect}
        onDelete={onDelete}
      />,
    );

    const deleteButton = screen.getByTestId('annotation-delete-ann-1');
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('ann-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should highlight active annotation', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        activeAnnotationId="ann-2"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const activeItem = screen.getByTestId('annotation-card-ann-2');
    expect(activeItem).toHaveAttribute('aria-current', 'true');
  });

  it('should not highlight inactive annotations', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        activeAnnotationId="ann-2"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const inactiveItem = screen.getByTestId('annotation-card-ann-1');
    expect(inactiveItem).not.toHaveAttribute('aria-current');
  });

  it('should render empty state when annotations is empty', () => {
    render(
      <AnnotationPanel
        annotations={[]}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('选中文本创建批注')).toBeInTheDocument();
    expect(screen.getByTestId('annotation-empty')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const list = screen.getByRole('list');
    expect(list).toHaveAttribute('aria-label', '批注列表');

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('should handle Enter key for selection', () => {
    const onSelect = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );

    const firstItem = screen.getByTestId('annotation-card-ann-1');
    fireEvent.keyDown(firstItem, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('ann-1');
  });

  it('should handle Space key for selection', () => {
    const onSelect = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );

    const firstItem = screen.getByTestId('annotation-card-ann-1');
    fireEvent.keyDown(firstItem, { key: ' ' });

    expect(onSelect).toHaveBeenCalledWith('ann-1');
  });

  it('should not select on other keys', () => {
    const onSelect = vi.fn();
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={onSelect}
        onDelete={vi.fn()}
      />,
    );

    const firstItem = screen.getByTestId('annotation-card-ann-1');
    fireEvent.keyDown(firstItem, { key: 'Tab' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should set title attribute for tooltip on selected text', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const textElement = screen.getByText('Test content');
    expect(textElement).toHaveAttribute('title', 'Test content');
  });

  it('should render delete button with proper aria-label', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const deleteButton = screen.getByTestId('annotation-delete-ann-1');
    expect(deleteButton).toHaveAttribute('aria-label', '删除批注: Test content');
    expect(deleteButton).toHaveAttribute('title', '删除批注');
  });

  it('should handle ArrowDown key for navigation', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const firstItem = screen.getByTestId('annotation-card-ann-1');
    fireEvent.keyDown(firstItem, { key: 'ArrowDown' });

    // The second item should receive focus
    const secondItem = screen.getByTestId('annotation-card-ann-2');
    expect(document.activeElement).toBe(secondItem);
  });

  it('should handle ArrowUp key for navigation', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const secondItem = screen.getByTestId('annotation-card-ann-2');
    secondItem.focus();
    fireEvent.keyDown(secondItem, { key: 'ArrowUp' });

    const firstItem = screen.getByTestId('annotation-card-ann-1');
    expect(document.activeElement).toBe(firstItem);
  });

  it('should have tabindex on annotation cards', () => {
    render(
      <AnnotationPanel
        annotations={mockAnnotations}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const items = screen.getAllByRole('listitem');
    items.forEach((item) => {
      expect(item).toHaveAttribute('tabindex', '0');
    });
  });
});
