import { MarkdownRenderer } from '../common/MarkdownRenderer';
import type { SourceSelectionRange } from '../common/MarkdownRenderer';
import styles from './CodeAnalysisComponents.module.css';

interface AnalysisMarkdownViewerProps {
  content: string;
  onTextSelect: (text: string, sourceRange?: SourceSelectionRange) => void;
  emptyLabel?: string;
}

export function AnalysisMarkdownViewer({ content, onTextSelect, emptyLabel }: AnalysisMarkdownViewerProps) {
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
    />
  );
}
