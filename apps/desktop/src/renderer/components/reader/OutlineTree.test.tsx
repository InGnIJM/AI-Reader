import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OutlineTree } from './OutlineTree';
import type { OutlineItem } from './OutlineTree';

afterEach(() => {
  cleanup();
});

const sampleItems: OutlineItem[] = [
  { id: 'a', title: 'Chapter 1: Introduction', level: 1, index: 0 },
  { id: 'b', title: '1.1 Background', level: 2, index: 1 },
  { id: 'c', title: '1.2 Motivation', level: 2, index: 2 },
  { id: 'd', title: 'Chapter 2: Methods', level: 1, index: 3 },
  { id: 'e', title: '2.1 Data Collection', level: 2, index: 4 },
  { id: 'f', title: '2.1.1 Survey Design', level: 3, index: 5 },
];

describe('OutlineTree', () => {
  describe('rendering', () => {
    it('should render all items', () => {
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);
      for (const item of sampleItems) {
        expect(screen.getByText(item.title)).toBeInTheDocument();
      }
    });

    it('should render empty state when items is empty', () => {
      render(<OutlineTree items={[]} onSelect={vi.fn()} />);
      expect(screen.getByTestId('outline-empty')).toBeInTheDocument();
      expect(screen.getByText('暂无大纲')).toBeInTheDocument();
    });

    it('should render a tree with treeitem roles', () => {
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);
      expect(screen.getByRole('tree')).toBeInTheDocument();
      const treeItems = screen.getAllByRole('treeitem');
      expect(treeItems).toHaveLength(sampleItems.length);
    });

    it('should apply active styling to the active item', () => {
      render(<OutlineTree items={sampleItems} activeIndex={3} onSelect={vi.fn()} />);
      const activeBtn = screen.getByTestId('outline-item-3');
      expect(activeBtn).toHaveAttribute('aria-current', 'true');
    });

    it('should not set aria-current on non-active items', () => {
      render(<OutlineTree items={sampleItems} activeIndex={3} onSelect={vi.fn()} />);
      const otherBtn = screen.getByTestId('outline-item-0');
      expect(otherBtn).not.toHaveAttribute('aria-current');
    });

    it('should mark active item as aria-selected in treeitem', () => {
      render(<OutlineTree items={sampleItems} activeIndex={1} onSelect={vi.fn()} />);
      const treeItems = screen.getAllByRole('treeitem');
      // item at index 1 is the second in the list
      expect(treeItems[1]).toHaveAttribute('aria-selected', 'true');
      expect(treeItems[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('should set title attribute on each button', () => {
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);
      for (const item of sampleItems) {
        const btn = screen.getByTestId(`outline-item-${item.index}`);
        expect(btn).toHaveAttribute('title', item.title);
      }
    });
  });

  describe('click navigation', () => {
    it('should call onSelect with the item index when clicked', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<OutlineTree items={sampleItems} onSelect={onSelect} />);

      await user.click(screen.getByText('1.2 Motivation'));
      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('should call onSelect for each item independently', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<OutlineTree items={sampleItems} onSelect={onSelect} />);

      await user.click(screen.getByText('Chapter 1: Introduction'));
      expect(onSelect).toHaveBeenCalledWith(0);

      await user.click(screen.getByText('2.1.1 Survey Design'));
      expect(onSelect).toHaveBeenCalledWith(5);

      expect(onSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe('keyboard navigation', () => {
    it('should call onSelect on Enter key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<OutlineTree items={sampleItems} onSelect={onSelect} />);

      const btn = screen.getByTestId('outline-item-0');
      btn.focus();
      await user.keyboard('{Enter}');
      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('should call onSelect on Space key', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<OutlineTree items={sampleItems} onSelect={onSelect} />);

      const btn = screen.getByTestId('outline-item-2');
      btn.focus();
      await user.keyboard(' ');
      expect(onSelect).toHaveBeenCalledWith(2);
    });

    it('should move focus down on ArrowDown', async () => {
      const user = userEvent.setup();
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);

      const firstBtn = screen.getByTestId('outline-item-0');
      firstBtn.focus();
      await user.keyboard('{ArrowDown}');

      expect(screen.getByTestId('outline-item-1')).toHaveFocus();
    });

    it('should move focus up on ArrowUp', async () => {
      const user = userEvent.setup();
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);

      const secondBtn = screen.getByTestId('outline-item-1');
      secondBtn.focus();
      await user.keyboard('{ArrowUp}');

      expect(screen.getByTestId('outline-item-0')).toHaveFocus();
    });

    it('should not move focus past the first item on ArrowUp', async () => {
      const user = userEvent.setup();
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);

      const firstBtn = screen.getByTestId('outline-item-0');
      firstBtn.focus();
      await user.keyboard('{ArrowUp}');

      expect(screen.getByTestId('outline-item-0')).toHaveFocus();
    });

    it('should not move focus past the last item on ArrowDown', async () => {
      const user = userEvent.setup();
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);

      const lastBtn = screen.getByTestId('outline-item-5');
      lastBtn.focus();
      await user.keyboard('{ArrowDown}');

      expect(screen.getByTestId('outline-item-5')).toHaveFocus();
    });
  });

  describe('edge cases', () => {
    it('should handle a single item', () => {
      const single: OutlineItem[] = [{ id: 'x', title: 'Only Item', level: 1, index: 0 }];
      const onSelect = vi.fn();
      render(<OutlineTree items={single} onSelect={onSelect} />);
      expect(screen.getByText('Only Item')).toBeInTheDocument();
    });

    it('should handle items without activeIndex', () => {
      render(<OutlineTree items={sampleItems} onSelect={vi.fn()} />);
      // No item should have aria-current
      for (const item of sampleItems) {
        const btn = screen.getByTestId(`outline-item-${item.index}`);
        expect(btn).not.toHaveAttribute('aria-current');
      }
    });

    it('should clamp level values above 6 to 6', () => {
      const items: OutlineItem[] = [{ id: 'x', title: 'Deep Item', level: 10, index: 0 }];
      render(<OutlineTree items={items} onSelect={vi.fn()} />);
      const btn = screen.getByText('Deep Item');
      // The level6 class should be applied (clamped from 10)
      expect(btn.className).toContain('level6');
    });

    it('should clamp level values below 1 to 1', () => {
      const items: OutlineItem[] = [{ id: 'x', title: 'Zero Level', level: 0, index: 0 }];
      render(<OutlineTree items={items} onSelect={vi.fn()} />);
      const btn = screen.getByText('Zero Level');
      expect(btn.className).toContain('level1');
    });

    it('should clamp fractional levels to nearest integer', () => {
      const items: OutlineItem[] = [{ id: 'x', title: 'Float Level', level: 2.7, index: 0 }];
      render(<OutlineTree items={items} onSelect={vi.fn()} />);
      const btn = screen.getByText('Float Level');
      expect(btn.className).toContain('level3');
    });

    it('should not call onSelect when non-actionable key is pressed', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<OutlineTree items={sampleItems} onSelect={onSelect} />);

      const btn = screen.getByTestId('outline-item-0');
      btn.focus();
      await user.keyboard('{Tab}');
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
