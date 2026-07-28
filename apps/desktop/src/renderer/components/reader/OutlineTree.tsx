import { useCallback, useRef } from 'react';
import styles from './OutlineTree.module.css';

/**
 * Single outline / table-of-contents item.
 */
export interface OutlineItem {
  /** Unique identifier for the item */
  id: string;
  /** Display title */
  title: string;
  /** Heading level (1-6) — controls indentation */
  level: number;
  /** Sequential index of this item in the document */
  index: number;
}

/**
 * OutlineTree props
 */
export interface OutlineTreeProps {
  /** Flat list of outline items to render */
  items: OutlineItem[];
  /** Index of the currently active / visible item */
  activeIndex?: number;
  /** Called when the user clicks or activates an item. Receives the item's `index`. */
  onSelect: (index: number) => void;
}

/**
 * Clamp a heading level to the supported range [1, 6].
 */
function clampLevel(level: number): number {
  return Math.max(1, Math.min(6, Math.round(level)));
}

/**
 * OutlineTree -- renders a hierarchical document outline with click-to-navigate.
 *
 * Items are displayed as a flat list with indentation driven by `level`.
 * The active item is visually highlighted. Supports keyboard navigation
 * (Enter / Space to activate, Arrow keys to move focus).
 *
 * Usage:
 * ```tsx
 * <OutlineTree
 *   items={outlineItems}
 *   activeIndex={currentIndex}
 *   onSelect={(idx) => scrollToSection(idx)}
 * />
 * ```
 */
export function OutlineTree({ items, activeIndex, onSelect }: OutlineTreeProps) {
  const listRef = useRef<HTMLUListElement>(null);

  const handleClick = useCallback(
    (index: number) => {
      onSelect(index);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(index);
        return;
      }

      // Arrow key navigation: move focus to adjacent items
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = listRef.current;
        if (!list) return;

        const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('button'));
        const currentPos = buttons.findIndex((btn) => btn === e.currentTarget);
        if (currentPos === -1) return;

        const nextPos =
          e.key === 'ArrowDown'
            ? Math.min(currentPos + 1, buttons.length - 1)
            : Math.max(currentPos - 1, 0);

        buttons[nextPos]?.focus();
      }
    },
    [onSelect],
  );

  if (items.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="outline-empty">
        <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
          list_alt
        </span>
        <span>暂无大纲</span>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      className={styles.list}
      role="tree"
      aria-label="文档大纲"
      data-testid="outline-tree"
    >
      {items.map((item) => {
        const level = clampLevel(item.level);
        const isActive = activeIndex === item.index;

        return (
          <li key={item.id} role="treeitem" aria-selected={isActive}>
            <button
              className={`${styles.item} ${styles[`level${level}`] ?? ''} ${isActive ? styles.itemActive : ''}`}
              onClick={() => handleClick(item.index)}
              onKeyDown={(e) => handleKeyDown(e, item.index)}
              aria-current={isActive ? 'true' : undefined}
              title={item.title}
              data-testid={`outline-item-${item.index}`}
            >
              {item.title}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
