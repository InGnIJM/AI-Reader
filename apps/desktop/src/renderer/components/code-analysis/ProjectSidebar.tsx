import styles from './CodeAnalysisComponents.module.css';

interface ProjectSidebarProps {
  projects: Array<{ id: string; name: string }>;
  documents: Array<{ id: string; goal: string }>;
  selectedProjectId?: string;
  selectedDocumentId?: string;
  language: 'zh-CN' | 'en-US';
  labels: {
    projects: string;
    conversations: string;
    noProjects: string;
    noConversations: string;
    selectDirectory: string;
    language: string;
    chinese: string;
    english: string;
  };
  onSelectDirectory: () => void;
  onSelectProject: (project: { id: string; name: string }) => void;
  onSelectDocument: (document: { id: string; goal: string }) => void;
  onLanguageChange: (language: 'zh-CN' | 'en-US') => void;
}

export function ProjectSidebar({
  projects,
  documents,
  selectedProjectId,
  selectedDocumentId,
  language,
  labels,
  onSelectDirectory,
  onSelectProject,
  onSelectDocument,
  onLanguageChange,
}: ProjectSidebarProps) {
  return (
    <aside className={styles.projectSidebar}>
      <button className={styles.primaryAction} type="button" onClick={onSelectDirectory}>
        {labels.selectDirectory}
      </button>

      <section className={styles.sidebarSection}>
        <h2>{labels.projects}</h2>
        <div className={styles.sidebarList}>
          {projects.length === 0 ? (
            <p className={styles.muted}>{labels.noProjects}</p>
          ) : (
            projects.map((project) => (
              <button
                className={styles.sidebarItem}
                data-active={project.id === selectedProjectId}
                type="button"
                aria-pressed={project.id === selectedProjectId}
                key={project.id}
                onClick={() => onSelectProject(project)}
              >
                {project.name}
              </button>
            ))
          )}
        </div>
      </section>

      <section className={`${styles.sidebarSection} ${styles.conversationSection}`}>
        <h2>{labels.conversations}</h2>
        <div className={styles.sidebarList}>
          {documents.length === 0 ? (
            <p className={styles.muted}>{labels.noConversations}</p>
          ) : (
            documents.map((document) => (
              <button
                className={styles.sidebarItem}
                data-active={document.id === selectedDocumentId}
                type="button"
                aria-pressed={document.id === selectedDocumentId}
                title={document.goal}
                key={document.id}
                onClick={() => onSelectDocument(document)}
              >
                {document.goal}
              </button>
            ))
          )}
        </div>
      </section>

      <label className={styles.languageControl}>
        <span>{labels.language}</span>
        <select
          aria-label={labels.language}
          value={language}
          onChange={(event) => onLanguageChange(event.target.value as 'zh-CN' | 'en-US')}
        >
          <option value="zh-CN">{labels.chinese}</option>
          <option value="en-US">{labels.english}</option>
        </select>
      </label>
    </aside>
  );
}
