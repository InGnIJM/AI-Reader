import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './TextSelectionToolbar.module.css';

/**
 * TextSelectionToolbar props
 */
export interface TextSelectionToolbarProps {
  /** The currently selected text */
  selectedText: string;
  /** Viewport-relative position (center-bottom of the selection) */
  position: { x: number; y: number };
  /** Called when the user clicks the "create note" action */
  onCreateNote: () => void;
  /** Called when the user clicks the "create question" action */
  onCreateQuestion: () => void;
  /** Called when the toolbar should be dismissed (e.g. click outside) */
  onClose: () => void;
}

/**
 * TextSelectionToolbar -- a floating toolbar that appears near text selections.
 *
 * Displays "Note" and "Question" action buttons. Handles viewport boundary
 * clamping so the toolbar never overflows the window. Auto-dismisses on
 * `mousedown` outside the toolbar (capture phase) and on `Escape` key.
 */
export function TextSelectionToolbar({
  selectedText,
  position,
  onCreateNote,
  onCreateQuestion,
  onClose,
}: TextSelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [clampedPos, setClampedPos] = useState(position);

  // Clamp toolbar position to stay within viewport bounds
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const rect = toolbar.getBoundingClientRect();
    const toolbarWidth = rect.width;
    const toolbarHeight = rect.height;
    const padding = 8;

    // Horizontal: keep centered on position.x but clamp to viewport
    let x = position.x;
    const halfWidth = toolbarWidth / 2;
    if (x - halfWidth < padding) {
      x = halfWidth + padding;
    } else if (x + halfWidth > window.innerWidth - padding) {
      x = window.innerWidth - halfWidth - padding;
    }

    // Vertical: place above selection; if not enough space, place below
    let y = position.y - toolbarHeight - 8;
    if (y < padding) {
      y = position.y + 24;
    }

    setClampedPos({ x, y });
  }, [position]);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Dismiss on mousedown outside the toolbar (capture phase)
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture phase to fire before the selection is cleared
    document.addEventListener('mousedown', handleMouseDown, { capture: true });
    return () => document.removeEventListener('mousedown', handleMouseDown, { capture: true });
  }, [onClose]);

  const handleCreateNote = useCallback(() => {
    onCreateNote();
  }, [onCreateNote]);

  const handleCreateQuestion = useCallback(() => {
    onCreateQuestion();
  }, [onCreateQuestion]);

  if (!selectedText) return null;

  return (
    <div
      ref={toolbarRef}
      className={styles.toolbar}
      style={{ left: clampedPos.x, top: clampedPos.y }}
      role="toolbar"
      aria-label="文本操作"
      data-testid="text-selection-toolbar"
    >
      <button
        className={styles.actionButton}
        onClick={handleCreateNote}
        aria-label="创建批注"
        title="创建批注"
        data-testid="toolbar-create-note"
      >
        <span className={`material-symbols-rounded ${styles.actionButtonIcon}`}>edit_note</span>
        批注
      </button>
      <button
        className={styles.actionButton}
        onClick={handleCreateQuestion}
        aria-label="创建提问"
        title="创建提问"
        data-testid="toolbar-create-question"
      >
        <span className={`material-symbols-rounded ${styles.actionButtonIcon}`}>help</span>
        提问
      </button>
    </div>
  );
}
