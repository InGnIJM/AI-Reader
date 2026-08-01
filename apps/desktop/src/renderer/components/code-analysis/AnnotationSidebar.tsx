import { useState, useCallback, useEffect, useRef } from 'react';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import styles from './CodeAnalysisComponents.module.css';

export interface AnalysisDiscussionMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalysisAnnotationItem {
  id: string;
  /** Owning analysis turn (document) id, used to scope highlights to the right turn */
  analysisDocumentId?: string;
  /** Source offset of the anchor start in the turn's markdown, when available */
  anchorStartOffset?: number;
  /** Source offset of the anchor end in the turn's markdown, when available */
  anchorEndOffset?: number;
  anchorExactText: string;
  /** The plain (rendered) text the user selected; preferred for display. */
  selectedText?: string;
  question: string;
  status: string;
  messages?: AnalysisDiscussionMessageItem[];
}

export interface AnnotationSidebarProps {
  annotations: AnalysisAnnotationItem[];
  activeAnnotationId?: string;
  onActivate?: (annotationId: string) => void;
  onViewSource?: (annotationId: string) => void;
  /** Called when the user deletes an annotation. */
  onDelete?: (annotationId: string) => void;
  /** Visible and accessible label for the destructive delete action. */
  deleteLabel?: string;
  /** Confirmation label shown before an annotation is permanently deleted. */
  confirmDeleteLabel?: string;
  /** Label that closes the annotation deletion confirmation dialog. */
  cancelLabel?: string;
  /** Explains the irreversible consequence of deleting an annotation. */
  deleteWarningLabel?: string;
  /** Label for the "view source" affordance; defaults to a hardcoded Chinese label. */
  viewSourceLabel?: string;
  emptyLabel?: string;
  statusLabels?: Record<string, string>;
}

export function AnnotationSidebar({
  annotations,
  activeAnnotationId,
  onActivate,
  onViewSource,
  onDelete,
  deleteLabel = 'Delete',
  confirmDeleteLabel = 'Delete permanently',
  cancelLabel = 'Cancel',
  deleteWarningLabel = 'This permanently deletes the annotation and its discussion.',
  viewSourceLabel,
  emptyLabel = 'No comments yet.',
  statusLabels,
}: AnnotationSidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    return activeAnnotationId ? new Set([activeAnnotationId]) : new Set();
  });
  const [deletingAnnotation, setDeletingAnnotation] = useState<AnalysisAnnotationItem | null>(null);

  // IDs whose answered state has already auto-expanded once. Auto-expansion
  // must only happen for newly appearing annotations; once the user manually
  // collapses a card, later annotation/active changes must not reopen it.
  const autoExpandedRef = useRef<Set<string>>(new Set());
  const manuallyCollapsedRef = useRef<Set<string>>(new Set());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const headerRefs = useRef(new Map<string, HTMLDivElement>());

  // Auto-expand the currently active annotation and newly answered annotations.
  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (
        activeAnnotationId &&
        !next.has(activeAnnotationId) &&
        !manuallyCollapsedRef.current.has(activeAnnotationId)
      ) {
        next.add(activeAnnotationId);
      }
      for (const annotation of annotations) {
        if (
          annotation.status === 'answered' &&
          annotation.messages &&
          annotation.messages.length > 0 &&
          !autoExpandedRef.current.has(annotation.id)
        ) {
          autoExpandedRef.current.add(annotation.id);
          next.add(annotation.id);
        }
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [activeAnnotationId, annotations]);

  useEffect(() => {
    if (!activeAnnotationId) return;
    const card = cardRefs.current.get(activeAnnotationId);
    const header = headerRefs.current.get(activeAnnotationId);
    if (typeof card?.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    header?.focus({ preventScroll: true });
  }, [activeAnnotationId]);

  const toggleExpand = useCallback(
    (annotationId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(annotationId)) {
          next.delete(annotationId);
          manuallyCollapsedRef.current.add(annotationId);
        } else {
          next.add(annotationId);
          manuallyCollapsedRef.current.delete(annotationId);
        }
        return next;
      });
      onActivate?.(annotationId);
    },
    [onActivate],
  );

  return (
    <div className={styles.annotationList}>
      {annotations.length === 0 ? (
        <p className={styles.muted}>{emptyLabel}</p>
      ) : (
        annotations.map((annotation) => {
          const isExpanded = expandedIds.has(annotation.id);
          return (
            <article
              className={styles.annotationItem}
              key={annotation.id}
              ref={(element) => {
                if (element) cardRefs.current.set(annotation.id, element);
                else cardRefs.current.delete(annotation.id);
              }}
            >
              {onDelete && (
                <button
                  type="button"
                  className={styles.deleteAnnotationBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingAnnotation(annotation);
                  }}
                  aria-label={deleteLabel}
                  title={deleteLabel}
                  data-testid={`annotation-delete-${annotation.id}`}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">delete</span>
                  <span className={styles.deleteAnnotationLabel}>{deleteLabel}</span>
                </button>
              )}
              <div
                className={styles.annotationHeader}
                ref={(element) => {
                  if (element) headerRefs.current.set(annotation.id, element);
                  else headerRefs.current.delete(annotation.id);
                }}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(annotation.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleExpand(annotation.id);
                  }
                }}
              >
                <blockquote
                  className={onViewSource ? styles.anchorText : undefined}
                  onClick={
                    onViewSource
                      ? (e) => {
                          e.stopPropagation();
                          onViewSource(annotation.id);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onViewSource
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onViewSource(annotation.id);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onViewSource ? 0 : undefined}
                  aria-label={onViewSource ? viewSourceLabel ?? '查看原文' : undefined}
                >
                  {annotation.selectedText ?? annotation.anchorExactText}
                </blockquote>
                <span>{statusLabels?.[annotation.status] ?? annotation.status}</span>
              </div>
              {isExpanded && (
                <div className={styles.annotationBody}>
                  <p>{annotation.question}</p>
                  {annotation.messages
                    ?.filter((message) => message.role === 'assistant')
                    .map((message) => (
                      <div className={styles.annotationReply} key={message.id}>
                        <MarkdownRenderer content={message.content} />
                      </div>
                    ))}
                  {onViewSource && (
                    <button
                      type="button"
                      className={styles.viewSourceBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewSource(annotation.id);
                      }}
                    >
                      {viewSourceLabel ?? '查看原文'}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })
      )}
      {deletingAnnotation ? (
        <div className={styles.dialogBackdrop}>
          <div
            className={styles.confirmDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-annotation-title"
            aria-describedby="delete-annotation-description"
          >
            <p id="delete-annotation-title">
              {confirmDeleteLabel}: {deletingAnnotation.selectedText ?? deletingAnnotation.anchorExactText}
            </p>
            <p className={styles.dialogDescription} id="delete-annotation-description">
              {deleteWarningLabel}
            </p>
            <div className={styles.confirmActions}>
              <button type="button" onClick={() => setDeletingAnnotation(null)}>
                {cancelLabel}
              </button>
              <button
                type="button"
                data-variant="danger"
                onClick={() => {
                  onDelete?.(deletingAnnotation.id);
                  setDeletingAnnotation(null);
                }}
              >
                {confirmDeleteLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
