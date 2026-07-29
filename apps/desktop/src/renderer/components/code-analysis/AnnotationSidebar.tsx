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

export function AnnotationSidebar({
  annotations,
  emptyLabel = 'No comments yet.',
  statusLabels,
}: {
  annotations: AnalysisAnnotationItem[];
  emptyLabel?: string;
  statusLabels?: Record<string, string>;
}) {
  return (
    <div className={styles.annotationList}>
      {annotations.length === 0 ? (
        <p className={styles.muted}>{emptyLabel}</p>
      ) : (
        annotations.map((annotation) => (
          <article className={styles.annotationItem} key={annotation.id}>
            <blockquote>{annotation.anchorExactText}</blockquote>
            <p>{annotation.question}</p>
            <span>{statusLabels?.[annotation.status] ?? annotation.status}</span>
            {annotation.messages
              ?.filter((message) => message.role === 'assistant')
              .map((message) => (
                <div className={styles.annotationReply} key={message.id}>
                  <MarkdownRenderer content={message.content} />
                </div>
              ))}
          </article>
        ))
      )}
    </div>
  );
}
