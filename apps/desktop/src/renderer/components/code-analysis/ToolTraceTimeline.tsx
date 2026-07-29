import styles from './CodeAnalysisComponents.module.css';

export interface ToolTraceItem {
  id?: string;
  toolName: string;
  resultSummary: string;
}

export function ToolTraceTimeline({
  traces,
  ariaLabel = 'Tool trace',
  emptyLabel = 'No tool calls yet.',
}: {
  traces: ToolTraceItem[];
  ariaLabel?: string;
  emptyLabel?: string;
}) {
  return (
    <div className={styles.traceList} aria-label={ariaLabel}>
      {traces.length === 0 ? (
        <p className={styles.muted}>{emptyLabel}</p>
      ) : (
        traces.map((trace, index) => (
          <div className={styles.traceItem} key={trace.id ?? `${trace.toolName}-${index}`}>
            <strong>{trace.toolName}</strong>
            <span>{trace.resultSummary}</span>
          </div>
        ))
      )}
    </div>
  );
}
