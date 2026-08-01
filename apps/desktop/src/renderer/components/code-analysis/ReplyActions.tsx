import { useState } from 'react';

import type { AnalysisExportFormat } from '@ai-reader/shared';

import styles from './CodeAnalysisComponents.module.css';

export interface ReplyActionsProps {
  disabled?: boolean;
  labels: {
    copy: string;
    checkout: string;
    fork: string;
    export: string;
    exportMarkdown: string;
    exportJson: string;
  };
  onCopy: () => void;
  onCheckout: () => void;
  onFork: () => void;
  onExport: (format: AnalysisExportFormat) => void;
}

export function ReplyActions({ disabled = false, labels, onCopy, onCheckout, onFork, onExport }: ReplyActionsProps) {
  const [exportOpen, setExportOpen] = useState(false);

  const exportReply = (format: AnalysisExportFormat) => {
    setExportOpen(false);
    onExport(format);
  };

  return (
    <div className={styles.replyActions} aria-label="Reply actions">
      <button type="button" className={styles.replyActionButton} disabled={disabled} onClick={onCopy} aria-label={labels.copy} title={labels.copy}>
        <span className="material-symbols-rounded" aria-hidden="true">content_copy</span>
      </button>
      <button type="button" className={styles.replyActionButton} disabled={disabled} onClick={onCheckout} aria-label={labels.checkout} title={labels.checkout}>
        <span className="material-symbols-rounded" aria-hidden="true">history</span>
      </button>
      <button type="button" className={styles.replyActionButton} disabled={disabled} onClick={onFork} aria-label={labels.fork} title={labels.fork}>
        <span className="material-symbols-rounded" aria-hidden="true">fork_right</span>
      </button>
      <div className={styles.replyExport}>
        <button type="button" className={styles.replyActionButton} disabled={disabled} onClick={() => setExportOpen((open) => !open)} aria-label={labels.export} title={labels.export} aria-haspopup="menu" aria-expanded={exportOpen}>
          <span className="material-symbols-rounded" aria-hidden="true">download</span>
        </button>
        {exportOpen ? (
          <div className={styles.replyExportMenu} role="menu">
            <button type="button" role="menuitem" onClick={() => exportReply('markdown')}>{labels.exportMarkdown}</button>
            <button type="button" role="menuitem" onClick={() => exportReply('json')}>{labels.exportJson}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
