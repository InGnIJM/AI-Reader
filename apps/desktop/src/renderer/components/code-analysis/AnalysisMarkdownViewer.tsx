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
}

export function AnalysisMarkdownViewer({
  content,
  onTextSelect,
  emptyLabel,
  annotations,
  activeAnnotationId,
  onAnnotationClick,
}: AnalysisMarkdownViewerProps) {
  if (!content) {
    return (
      <div className={styles.emptyDocument}>
        {emptyLabel ?? 'Select a directory and run an analysis.'}
      </div>
    );
  }

  return (
    <MarkdownRenderer
      content={content}
      onTextSelect={(text, _range, sourceRange) => onTextSelect(text, sourceRange)}
      annotations={annotations}
      activeAnnotationId={activeAnnotationId}
      onAnnotationClick={onAnnotationClick}
    />
  );
}
