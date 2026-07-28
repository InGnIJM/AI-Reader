import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OutlineTree, createHeadingIdResolver } from '../OutlineTree';
import type { OutlineItem } from '../OutlineTree';

afterEach(() => {
  cleanup();
});

describe('OutlineTree', () => {
  const mockItems: OutlineItem[] = [
    { id: '1', title: 'Chapter 1', level: 1 },
    { id: '2', title: 'Section 1.1', level: 2 },
    { id: '3', title: 'Section 1.2', level: 2 },
    { id: '4', title: 'Chapter 2', level: 1 },
    { id: '5', title: 'Section 2.1', level: 3 },
  ];

  it('should render all outline items', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Section 1.1')).toBeInTheDocument();
    expect(screen.getByText('Section 1.2')).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    expect(screen.getByText('Section 2.1')).toBeInTheDocument();
  });

  it('should apply correct indentation based on level', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} />);

    const items = screen.getAllByRole('button');
    expect(items[0]).toHaveStyle({ paddingLeft: '12px' }); // level 1: (1-1)*16 + 12 = 12
    expect(items[1]).toHaveStyle({ paddingLeft: '28px' }); // level 2: (2-1)*16 + 12 = 28
    expect(items[2]).toHaveStyle({ paddingLeft: '28px' }); // level 2
    expect(items[3]).toHaveStyle({ paddingLeft: '12px' }); // level 1
    expect(items[4]).toHaveStyle({ paddingLeft: '44px' }); // level 3: (3-1)*16 + 12 = 44
  });

  it('should call onNavigate with item id when clicked', () => {
    const onNavigate = vi.fn();
    render(<OutlineTree items={mockItems} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Section 1.1'));
    expect(onNavigate).toHaveBeenCalledWith('2');
  });

  it('should not throw when onNavigate is not provided', () => {
    render(<OutlineTree items={mockItems} />);

    expect(() => {
      fireEvent.click(screen.getByText('Chapter 1'));
    }).not.toThrow();
  });

  it('should highlight active item', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} activeId="2" />);

    const activeItem = screen.getByText('Section 1.1').closest('button');
    expect(activeItem).toHaveAttribute('data-active', 'true');
    expect(activeItem).toHaveAttribute('aria-current', 'true');
  });

  it('should not highlight inactive items', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} activeId="2" />);

    const inactiveItem = screen.getByText('Chapter 1').closest('button');
    expect(inactiveItem).toHaveAttribute('data-active', 'false');
    expect(inactiveItem).not.toHaveAttribute('aria-current');
  });

  it('should accept null activeId', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} activeId={null} />);

    const item = screen.getByText('Chapter 1').closest('button');
    expect(item).toHaveAttribute('data-active', 'false');
  });

  it('should render empty state when items is empty', () => {
    render(<OutlineTree items={[]} onNavigate={vi.fn()} />);

    expect(screen.getByText('暂无目录')).toBeInTheDocument();
    expect(screen.getByTestId('outline-empty')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(<OutlineTree items={mockItems} onNavigate={vi.fn()} />);

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveAttribute('aria-label', '文档目录');

    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(5);
  });

  it('should handle Enter key navigation', () => {
    const onNavigate = vi.fn();
    render(<OutlineTree items={mockItems} onNavigate={onNavigate} />);

    const firstItem = screen.getByText('Chapter 1').closest('button');
    firstItem?.focus();
    fireEvent.keyDown(firstItem!, { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('1');
  });

  it('should handle Space key navigation', () => {
    const onNavigate = vi.fn();
    render(<OutlineTree items={mockItems} onNavigate={onNavigate} />);

    const firstItem = screen.getByText('Chapter 1').closest('button');
    firstItem?.focus();
    fireEvent.keyDown(firstItem!, { key: ' ' });

    expect(onNavigate).toHaveBeenCalledWith('1');
  });

  it('should not navigate on other keys', () => {
    const onNavigate = vi.fn();
    render(<OutlineTree items={mockItems} onNavigate={onNavigate} />);

    const firstItem = screen.getByText('Chapter 1').closest('button');
    fireEvent.keyDown(firstItem!, { key: 'Tab' });

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('should set title attribute for tooltip on long text', () => {
    const longItems: OutlineItem[] = [
      { id: '1', title: 'This is a very long chapter title that should be truncated', level: 1 },
    ];
    render(<OutlineTree items={longItems} onNavigate={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', 'This is a very long chapter title that should be truncated');
  });

  it('should clamp level to [1, 6] range', () => {
    const edgeItems: OutlineItem[] = [
      { id: '1', title: 'Level 0 clamped', level: 0 },
      { id: '2', title: 'Level 7 clamped', level: 7 },
    ];
    render(<OutlineTree items={edgeItems} onNavigate={vi.fn()} />);

    const items = screen.getAllByRole('button');
    // level 0 clamped to 1: (1-1)*16 + 12 = 12
    expect(items[0]).toHaveStyle({ paddingLeft: '12px' });
    // level 7 clamped to 6: (6-1)*16 + 12 = 92
    expect(items[1]).toHaveStyle({ paddingLeft: '92px' });
  });
});

describe('createHeadingIdResolver', () => {
  const mockItems: OutlineItem[] = [
    { id: '1', title: 'Chapter 1', level: 1 },
    { id: '2', title: 'Section 1.1', level: 2 },
    { id: '3', title: 'Chapter 2', level: 1 },
  ];

  it('should return a function that maps title to id', () => {
    const resolver = createHeadingIdResolver(mockItems);

    expect(resolver('Chapter 1')).toBe('1');
    expect(resolver('Section 1.1')).toBe('2');
    expect(resolver('Chapter 2')).toBe('3');
  });

  it('should return undefined for unknown titles', () => {
    const resolver = createHeadingIdResolver(mockItems);

    expect(resolver('Nonexistent Title')).toBeUndefined();
  });

  it('should trim whitespace from input titles', () => {
    const resolver = createHeadingIdResolver(mockItems);

    expect(resolver('  Chapter 1  ')).toBe('1');
  });

  it('should handle empty items array', () => {
    const resolver = createHeadingIdResolver([]);

    expect(resolver('Anything')).toBeUndefined();
  });

  it('should use last id for duplicate titles', () => {
    const dupItems: OutlineItem[] = [
      { id: 'a', title: 'Same Title', level: 1 },
      { id: 'b', title: 'Same Title', level: 2 },
    ];
    const resolver = createHeadingIdResolver(dupItems);

    expect(resolver('Same Title')).toBe('b');
  });

  it('should trim whitespace from stored titles', () => {
    const spacedItems: OutlineItem[] = [
      { id: 'x', title: '  Trimmed Title  ', level: 1 },
    ];
    const resolver = createHeadingIdResolver(spacedItems);

    expect(resolver('Trimmed Title')).toBe('x');
  });
});
