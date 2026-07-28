import { useCallback, useRef } from 'react';
import styles from './AnnotationPanel.module.css';

/**
 * Annotation data shape displayed in the panel.
 */
export interface AnnotationItem {
  /** Unique identifier */
  id: string;
  /** The selected text that was annotated */
  anchorExactText: string;
  /** Annotation type: 'note' | 'question' | 'highlight' */
  type: string;
  /** Optional user-provided content / comment */
  content?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * AnnotationPanel props
 */
export interface AnnotationPanelProps {
  /** List of annotations to display */
  annotations: AnnotationItem[];
  /** ID of the currently active / focused annotation */
  activeAnnotationId?: string;
  /** Called when the user clicks an annotation card */
  onSelect: (id: string) => void;
  /** Called when the user clicks the delete button on an annotation */
  onDelete: (id: string) => void;
}

/**
 * Map annotation type to Material Symbols icon name.
 */
function getTypeIcon(type: string): string {
  switch (type) {
    case 'question':
      return 'help';
    case 'highlight':
      return 'ink_highlighter';
    case 'note':
    default:
      return 'edit_note';
  }
}

/**
 * Format an ISO timestamp to a short relative or absolute display.
 */
function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * AnnotationPanel -- displays a list of annotations in the right sidebar.
 *
 * Each annotation card shows the type icon, a preview of the selected text,
 * optional user content, timestamp, and a delete button. Supports keyboard
 * navigation (Tab between cards, Enter to activate, Arrow keys to move).
 */
export function AnnotationPanel({
  annotations,
  activeAnnotationId,
  onSelect,
  onDelete,
}: AnnotationPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleCardClick = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect],
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(id);
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = listRef.current;
        if (!list) return;

        const cards = Array.from(list.querySelectorAll<HTMLDivElement>('[data-testid^="annotation-card-"]'));
        const currentPos = cards.findIndex((card) => card === e.currentTarget);
        if (currentPos === -1) return;

        const nextPos =
          e.key === 'ArrowDown'
            ? Math.min(currentPos + 1, cards.length - 1)
            : Math.max(currentPos - 1, 0);

        cards[nextPos]?.focus();
      }
    },
    [onSelect],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
      e.stopPropagation();
      onDelete(id);
    },
    [onDelete],
  );

  const handleDeleteKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onDelete(id);
      }
    },
    [onDelete],
  );

  if (annotations.length === 0) {
    return (
      <div className={styles.panel} data-testid="annotation-panel">
        <div className={styles.emptyState} data-testid="annotation-empty">
          <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
            edit_note
          </span>
          <span>选中文本创建批注</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="annotation-panel">
      <div
        ref={listRef}
        className={styles.list}
        role="list"
        aria-label="批注列表"
        data-testid="annotation-list"
      >
        {annotations.map((ann) => {
          const isActive = activeAnnotationId === ann.id;

          return (
            <div
              key={ann.id}
              className={`${styles.card} ${isActive ? styles.cardActive : ''}`}
              role="listitem"
              tabIndex={0}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => handleCardClick(ann.id)}
              onKeyDown={(e) => handleCardKeyDown(e, ann.id)}
              data-testid={`annotation-card-${ann.id}`}
            >
              <div className={styles.cardHeader}>
                <span className={`material-symbols-rounded ${styles.typeIcon}`}>
                  {getTypeIcon(ann.type)}
                </span>
                <span className={styles.selectedText} title={ann.anchorExactText}>
                  {ann.anchorExactText}
                </span>
              </div>

              {ann.content && (
                <div className={styles.cardContent}>{ann.content}</div>
              )}

              <div className={styles.cardFooter}>
                <span className={styles.timestamp}>
                  {formatTimestamp(ann.createdAt)}
                </span>
                <button
                  className={styles.deleteButton}
                  onClick={(e) => handleDelete(e, ann.id)}
                  onKeyDown={(e) => handleDeleteKeyDown(e, ann.id)}
                  aria-label={`删除批注: ${ann.anchorExactText}`}
                  title="删除批注"
                  data-testid={`annotation-delete-${ann.id}`}
                >
                  <span className="material-symbols-rounded">close</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
