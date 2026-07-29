import { useState, useCallback, useEffect } from 'react';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import styles from './CodeAnalysisComponents.module.css';

export interface AnalysisDiscussionMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalysisAnnotationItem {
  id: string;
  anchorExactText: string;
  question: string;
  status: string;
  messages?: AnalysisDiscussionMessageItem[];
}

export interface AnnotationSidebarProps {
  annotations: AnalysisAnnotationItem[];
  activeAnnotationId?: string;
  onActivate?: (annotationId: string) => void;
  onViewSource?: (annotationId: string) => void;
  emptyLabel?: string;
  statusLabels?: Record<string, string>;
}

export function AnnotationSidebar({
  annotations,
  activeAnnotationId,
  onActivate,
  onViewSource,
  emptyLabel = 'No comments yet.',
  statusLabels,
}: AnnotationSidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    return activeAnnotationId ? new Set([activeAnnotationId]) : new Set();
  });

  // Auto-expand newly active annotations and answered annotations
  useEffect(() => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (activeAnnotationId && !next.has(activeAnnotationId)) {
        next.add(activeAnnotationId);
      }
      for (const annotation of annotations) {
        if (annotation.status === 'answered' && annotation.messages && annotation.messages.length > 0) {
          next.add(annotation.id);
        }
      }
      return next.size !== prev.size ? next : prev;
    });
  }, [activeAnnotationId, annotations]);

  const toggleExpand = useCallback(
    (annotationId: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(annotationId)) {
          next.delete(annotationId);
        } else {
          next.add(annotationId);
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
            <article className={styles.annotationItem} key={annotation.id}>
              <div
                className={styles.annotationHeader}
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
                <blockquote>{annotation.anchorExactText}</blockquote>
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
                      查看原文
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })
      )}
    </div>
  );
}
