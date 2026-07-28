import styles from './CodeAnalysisComponents.module.css';

export interface AnalysisAnnotationItem {
  id: string;
  anchorExactText: string;
  question: string;
  status: string;
}

export function AnnotationSidebar({ annotations }: { annotations: AnalysisAnnotationItem[] }) {
  return (
    <div className={styles.annotationList}>
      {annotations.length === 0 ? (
        <p className={styles.muted}>No comments yet.</p>
      ) : (
        annotations.map((annotation) => (
          <article className={styles.annotationItem} key={annotation.id}>
            <blockquote>{annotation.anchorExactText}</blockquote>
            <p>{annotation.question}</p>
            <span>{annotation.status}</span>
          </article>
        ))
      )}
    </div>
  );
}
