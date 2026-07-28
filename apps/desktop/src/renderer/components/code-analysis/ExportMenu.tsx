import styles from './CodeAnalysisComponents.module.css';

interface ExportMenuProps {
  disabled?: boolean;
  onExportMarkdown: () => void;
  onExportJson: () => void;
}

export function ExportMenu({ disabled, onExportMarkdown, onExportJson }: ExportMenuProps) {
  return (
    <div className={styles.exportMenu}>
      <button type="button" onClick={onExportMarkdown} disabled={disabled}>
        Export MD
      </button>
      <button type="button" onClick={onExportJson} disabled={disabled}>
        Export JSON
      </button>
    </div>
  );
}
