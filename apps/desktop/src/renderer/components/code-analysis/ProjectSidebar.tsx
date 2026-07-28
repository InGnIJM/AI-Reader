import styles from './CodeAnalysisComponents.module.css';

interface ProjectSidebarProps {
  projectName?: string;
  onSelectDirectory: () => void;
}

export function ProjectSidebar({ projectName, onSelectDirectory }: ProjectSidebarProps) {
  return (
    <aside className={styles.projectSidebar}>
      <button type="button" onClick={onSelectDirectory}>
        Select Directory
      </button>
      <div className={styles.projectName}>{projectName ?? 'No directory selected'}</div>
    </aside>
  );
}
