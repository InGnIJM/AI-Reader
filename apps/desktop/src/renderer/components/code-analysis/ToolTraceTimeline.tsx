import styles from './CodeAnalysisComponents.module.css';

export interface ToolTraceItem {
  id?: string;
  toolName: string;
  resultSummary: string;
}

export function ToolTraceTimeline({ traces }: { traces: ToolTraceItem[] }) {
  return (
    <div className={styles.traceList} aria-label="Tool trace">
      {traces.length === 0 ? (
        <p className={styles.muted}>No tool calls yet.</p>
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
