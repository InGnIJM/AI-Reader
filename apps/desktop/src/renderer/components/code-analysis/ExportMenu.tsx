import styles from './CodeAnalysisComponents.module.css';

interface ExportMenuProps {
  disabled?: boolean;
  markdownLabel?: string;
  jsonLabel?: string;
  onExportMarkdown: () => void;
  onExportJson: () => void;
}

export function ExportMenu({
  disabled,
  markdownLabel = 'Export MD',
  jsonLabel = 'Export JSON',
  onExportMarkdown,
  onExportJson,
}: ExportMenuProps) {
  return (
    <div className={styles.exportMenu}>
      <button type="button" onClick={onExportMarkdown} disabled={disabled}>
        {markdownLabel}
      </button>
      <button type="button" onClick={onExportJson} disabled={disabled}>
        {jsonLabel}
      </button>
    </div>
  );
}
