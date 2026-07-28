import { MarkdownRenderer } from '../common/MarkdownRenderer';
import styles from './CodeAnalysisComponents.module.css';

interface AnalysisMarkdownViewerProps {
  content: string;
  onTextSelect: (text: string) => void;
}

export function AnalysisMarkdownViewer({ content, onTextSelect }: AnalysisMarkdownViewerProps) {
  if (!content) {
    return <div className={styles.emptyDocument}>Select a directory and run an analysis.</div>;
  }

  return <MarkdownRenderer content={content} onTextSelect={(text) => onTextSelect(text)} />;
}
