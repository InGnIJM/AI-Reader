import { useState } from 'react';

import type { AnalysisSession } from '@ai-reader/shared';

import styles from './CodeAnalysisComponents.module.css';

interface SidebarProject {
  id: string;
  name: string;
  conversationCount?: number;
}

interface SidebarDocument {
  id: string;
  goal: string;
  projectId: string | null;
}

interface ProjectSidebarProps {
  projects: SidebarProject[];
  recentDocuments: SidebarDocument[];
  localDocuments: SidebarDocument[];
  documentsByProject: Record<string, SidebarDocument[]>;
  expandedProjectIds: Set<string>;
  selectedProjectId?: string;
  selectedDocumentId?: string;
  language: 'zh-CN' | 'en-US';
  labels: {
    projects: string;
    recentConversations: string;
    localDocuments: string;
    noProjects: string;
    noConversations: string;
    selectDirectory: string;
    language: string;
    chinese: string;
    english: string;
  };
  onSelectDirectory: () => void;
  onToggleProject: (project: SidebarProject) => void;
  onSelectLocal: () => void;
  onSelectDocument: (document: SidebarDocument) => void;
  onLanguageChange: (language: 'zh-CN' | 'en-US') => void;

  // Session props (optional)
  recentSessions?: AnalysisSession[];
  selectedSessionId?: string;
  onSelectSession?: (session: AnalysisSession) => void;
}

function ConversationList({
  documents,
  selectedDocumentId,
  emptyLabel,
  onSelectDocument,
}: {
  documents: SidebarDocument[];
  selectedDocumentId?: string;
  emptyLabel: string;
  onSelectDocument: (document: SidebarDocument) => void;
}) {
  if (documents.length === 0) return <p className={styles.muted}>{emptyLabel}</p>;

  return (
    <>
      {documents.map((document) => (
        <button
          className={styles.conversationItem}
          data-active={document.id === selectedDocumentId}
          type="button"
          aria-pressed={document.id === selectedDocumentId}
          title={document.goal}
          key={document.id}
          onClick={() => onSelectDocument(document)}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            description
          </span>
          <span>{document.goal}</span>
        </button>
      ))}
    </>
  );
}

function SessionList({
  sessions,
  selectedSessionId,
  emptyLabel,
  onSelectSession,
}: {
  sessions: AnalysisSession[];
  selectedSessionId?: string;
  emptyLabel: string;
  onSelectSession?: (session: AnalysisSession) => void;
}) {
  if (sessions.length === 0) return <p className={styles.muted}>{emptyLabel}</p>;

  return (
    <>
      {sessions.map((session) => (
        <button
          className={styles.conversationItem}
          data-active={session.id === selectedSessionId}
          type="button"
          aria-pressed={session.id === selectedSessionId}
          title={session.title}
          key={session.id}
          onClick={() => onSelectSession?.(session)}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            {session.status === 'archived' ? 'archive' : 'description'}
          </span>
          <span>{session.title}</span>
        </button>
      ))}
    </>
  );
}

export function ProjectSidebar({
  projects,
  recentDocuments,
  localDocuments,
  documentsByProject,
  expandedProjectIds,
  selectedProjectId,
  selectedDocumentId,
  language,
  labels,
  onSelectDirectory,
  onToggleProject,
  onSelectLocal,
  onSelectDocument,
  onLanguageChange,
  recentSessions,
  selectedSessionId,
  onSelectSession,
}: ProjectSidebarProps) {
  const [localExpanded, setLocalExpanded] = useState(false);

  // Determine which data to show
  const hasSessions = recentSessions !== undefined && recentSessions.length > 0;

  // Derive sessions by project
  const sessionsByProject = hasSessions
    ? (recentSessions ?? []).reduce<Record<string, AnalysisSession[]>>((acc, session) => {
        if (session.projectId) {
          acc[session.projectId] = acc[session.projectId] ?? [];
          acc[session.projectId].push(session);
        }
        return acc;
      }, {})
    : {};

  const noProjectSessions = hasSessions
    ? (recentSessions ?? []).filter((s) => !s.projectId)
    : [];

  return (
    <aside className={styles.projectSidebar}>
      <button className={styles.primaryAction} type="button" onClick={onSelectDirectory}>
        <span className="material-symbols-rounded" aria-hidden="true">
          create_new_folder
        </span>
        <span>{labels.selectDirectory}</span>
      </button>

      <section className={styles.sidebarSection}>
        <h2>{labels.recentConversations}</h2>
        <div className={styles.sidebarList}>
          {hasSessions ? (
            <SessionList
              sessions={recentSessions ?? []}
              selectedSessionId={selectedSessionId}
              emptyLabel={labels.noConversations}
              onSelectSession={onSelectSession}
            />
          ) : (
            <ConversationList
              documents={recentDocuments}
              selectedDocumentId={selectedDocumentId}
              emptyLabel={labels.noConversations}
              onSelectDocument={onSelectDocument}
            />
          )}
        </div>
      </section>

      <section className={`${styles.sidebarSection} ${styles.projectTreeSection}`}>
        <h2>{labels.projects}</h2>
        <div className={styles.projectTree}>
          <div className={styles.folderGroup}>
            <button
              className={styles.folderRow}
              data-active={!selectedProjectId}
              type="button"
              aria-expanded={localExpanded}
              onClick={() => {
                setLocalExpanded((current) => !current);
                onSelectLocal();
              }}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                {localExpanded ? 'expand_more' : 'chevron_right'}
              </span>
              <span className="material-symbols-rounded" aria-hidden="true">
                {localExpanded ? 'folder_open' : 'folder'}
              </span>
              <span>{labels.localDocuments}</span>
              <span className={styles.folderCount} aria-hidden="true">
                {hasSessions ? noProjectSessions.length : localDocuments.length}
              </span>
            </button>
            {localExpanded ? (
              <div className={styles.folderChildren}>
                {hasSessions ? (
                  <SessionList
                    sessions={noProjectSessions}
                    selectedSessionId={selectedSessionId}
                    emptyLabel={labels.noConversations}
                    onSelectSession={onSelectSession}
                  />
                ) : (
                  <ConversationList
                    documents={localDocuments}
                    selectedDocumentId={selectedDocumentId}
                    emptyLabel={labels.noConversations}
                    onSelectDocument={onSelectDocument}
                  />
                )}
              </div>
            ) : null}
          </div>

          {projects.length === 0 ? (
            <p className={styles.muted}>{labels.noProjects}</p>
          ) : (
            projects.map((project) => {
              const expanded = expandedProjectIds.has(project.id);
              const projectSessions = sessionsByProject[project.id] ?? [];
              const projectDocuments = documentsByProject[project.id] ?? [];
              return (
                <div className={styles.folderGroup} key={project.id}>
                  <button
                    className={styles.folderRow}
                    data-active={project.id === selectedProjectId}
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => onToggleProject(project)}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      {expanded ? 'expand_more' : 'chevron_right'}
                    </span>
                    <span className="material-symbols-rounded" aria-hidden="true">
                      {expanded ? 'folder_open' : 'folder'}
                    </span>
                    <span>{project.name}</span>
                    <span className={styles.folderCount} aria-hidden="true">
                      {hasSessions
                        ? (project.conversationCount ?? projectSessions.length)
                        : (project.conversationCount ?? projectDocuments.length)}
                    </span>
                  </button>
                  {expanded ? (
                    <div className={styles.folderChildren}>
                      {hasSessions ? (
                        <SessionList
                          sessions={projectSessions}
                          selectedSessionId={selectedSessionId}
                          emptyLabel={labels.noConversations}
                          onSelectSession={onSelectSession}
                        />
                      ) : (
                        <ConversationList
                          documents={projectDocuments}
                          selectedDocumentId={selectedDocumentId}
                          emptyLabel={labels.noConversations}
                          onSelectDocument={onSelectDocument}
                        />
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
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
