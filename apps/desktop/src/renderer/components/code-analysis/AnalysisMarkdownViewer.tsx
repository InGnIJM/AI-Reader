import { useEffect, useRef } from 'react';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import type { AnnotationDef, SourceSelectionRange } from '../common/MarkdownRenderer';
import styles from './CodeAnalysisComponents.module.css';

interface AnalysisMarkdownViewerProps {
  content: string;
  onTextSelect: (text: string, sourceRange?: SourceSelectionRange) => void;
  emptyLabel?: string;
  /** Annotations to highlight, keyed to this document's source offsets. */
  annotations?: AnnotationDef[];
  /** ID of the currently active/focused annotation. */
  activeAnnotationId?: string;
  /** Called when a highlighted mark is clicked or activated via keyboard. */
  onAnnotationClick?: (annotationId: string) => void;
  /** Analysis document owning this rendered content. */
  documentId?: string;
  /** Called when this article occupies the reader's visible area. */
  onVisible?: (documentId: string) => void;
}

export function AnalysisMarkdownViewer({
  content,
  onTextSelect,
  emptyLabel,
  annotations,
  activeAnnotationId,
  onAnnotationClick,
  documentId,
  onVisible,
}: AnalysisMarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !documentId || !onVisible || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6)) {
          onVisible(documentId);
        }
      },
      { threshold: [0.6] },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [documentId, onVisible]);

  if (!content) {
    return (
      <div className={styles.emptyDocument}>
        {emptyLabel ?? 'Select a directory and run an analysis.'}
      </div>
    );
  }

  return (
    <div ref={containerRef} data-analysis-document-id={documentId}>
    <MarkdownRenderer
      content={content}
      onTextSelect={(text, _range, sourceRange) => onTextSelect(text, sourceRange)}
      annotations={annotations}
      activeAnnotationId={activeAnnotationId}
      onAnnotationClick={onAnnotationClick}
    />
    </div>
  );
}
