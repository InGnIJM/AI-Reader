import { useCallback } from 'react';
import styles from './OutlineTree.module.css';

/**
 * 单个目录条目
 */
export interface OutlineItem {
  /** 唯一标识符 */
  id: string;
  /** 标题文本 */
  title: string;
  /** 层级深度 (1-6) */
  level: number;
}

/**
 * OutlineTree props
 */
export interface OutlineTreeProps {
  /** 目录条目列表 */
  items: OutlineItem[];
  /** 当前激活的条目 ID */
  activeId?: string | null;
  /** 点击导航回调，接收章节 id */
  onNavigate?: (id: string) => void;
}

/**
 * OutlineTree — 文档目录树组件
 *
 * 展示文档的标题层级结构，支持点击导航到对应位置。
 * 配合 MarkdownRenderer 的 getHeadingId 使用可实现滚动定位。
 *
 * @example
 * ```tsx
 * const headingIdResolver = createHeadingIdResolver(chapters);
 *
 * <OutlineTree
 *   items={chapters.map(ch => ({ id: ch.id, title: ch.title, level: ch.level }))}
 *   activeId={activeChapterId}
 *   onNavigate={(id) => {
 *     const el = document.getElementById(id);
 *     el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
 *     setActiveChapterId(id);
 *   }}
 * />
 * <MarkdownRenderer content={content} getHeadingId={headingIdResolver} />
 * ```
 */
export function OutlineTree({ items, activeId, onNavigate }: OutlineTreeProps) {
  const handleClick = useCallback(
    (id: string) => () => {
      onNavigate?.(id);
    },
    [onNavigate],
  );

  const handleKeyDown = useCallback(
    (id: string) => (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNavigate?.(id);
      }
    },
    [onNavigate],
  );

  if (items.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="outline-empty">
        <span className={`material-symbols-rounded ${styles.emptyIcon}`}>
          list
        </span>
        <span>暂无目录</span>
      </div>
    );
  }

  return (
    <nav className={styles.container} aria-label="文档目录">
      <ul className={styles.list} role="list">
        {items.map((item) => (
          <li key={item.id} role="listitem">
            <button
              className={styles.item}
              style={{ paddingLeft: `${(Math.min(Math.max(item.level, 1), 6) - 1) * 16 + 12}px` }}
              data-active={item.id === activeId}
              onClick={handleClick(item.id)}
              onKeyDown={handleKeyDown(item.id)}
              aria-current={item.id === activeId ? 'true' : undefined}
              title={item.title}
            >
              <span className={styles.title}>{item.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Creates a heading id resolver function for MarkdownRenderer.
 *
 * Builds a title-to-id lookup map from the outline items,
 * so that MarkdownRenderer can assign matching `id` attributes
 * to heading elements for scroll navigation.
 *
 * @param items - Outline items (same data passed to OutlineTree)
 * @returns A function compatible with MarkdownRenderer's `getHeadingId` prop
 *
 * @example
 * ```tsx
 * const resolver = createHeadingIdResolver(outlineItems);
 * <MarkdownRenderer content={content} getHeadingId={resolver} />
 * ```
 */
export function createHeadingIdResolver(
  items: OutlineItem[],
): (headingText: string) => string | undefined {
  const titleToId = new Map<string, string>();
  for (const item of items) {
    titleToId.set(item.title.trim(), item.id);
  }
  return (headingText: string) => titleToId.get(headingText.trim());
}
