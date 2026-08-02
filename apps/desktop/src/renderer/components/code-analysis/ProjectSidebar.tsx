import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AnalysisExportFormat, AnalysisSession, AnalysisSessionStatus } from '@ai-reader/shared';

import styles from './CodeAnalysisComponents.module.css';

interface SidebarProject {
  id: string;
  name: string;
  conversationCount?: number;
  archivedConversationCount?: number;
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
  sessionsByProject?: Record<string, AnalysisSession[]>;
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
    activeSessions?: string;
    archivedSessions?: string;
    sessionStatus?: string;
    manageSession?: string;
    renameSession?: string;
    archiveSession?: string;
    restoreSession?: string;
    deleteSession?: string;
    confirmDelete?: string;
    cancel?: string;
    sessionTitle?: string;
    invalidSessionTitle?: string;
    deleteSessionWarning?: string;
    newSession?: string;
    createSessionBranch?: string;
    exportSessionMarkdown?: string;
    exportSessionJson?: string;
  };
  onSelectDirectory: () => void;
  onToggleProject: (project: SidebarProject) => void;
  onSelectLocal: () => void;
  onSelectDocument: (document: SidebarDocument) => void;
  onLanguageChange: (language: 'zh-CN' | 'en-US') => void;

  // Session props (optional)
  recentSessions?: AnalysisSession[];
  localSessions?: AnalysisSession[];
  sessionStatus?: AnalysisSessionStatus;
  selectedSessionId?: string;
  onSelectSession?: (session: AnalysisSession) => void;
  onSessionStatusChange?: (status: AnalysisSessionStatus) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string) => void;
  onRestoreSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onForkActiveSession?: (sessionId: string) => void;
  onExportSession?: (sessionId: string, format: AnalysisExportFormat) => void;
  onCreateSession?: (projectId: string | null) => void;
  sessionActionsDisabled?: boolean;
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
  emptyLabel,
  listKey,
  renderSession,
}: {
  sessions: AnalysisSession[];
  emptyLabel: string;
  listKey: string;
  renderSession: (session: AnalysisSession, rowKey: string) => ReactNode;
}) {
  if (sessions.length === 0) return <p className={styles.muted}>{emptyLabel}</p>;

  return (
    <>
      {sessions.map((session) => {
        const rowKey = `${listKey}:${session.id}`;
        return <div key={rowKey}>{renderSession(session, rowKey)}</div>;
      })}
    </>
  );
}

interface SessionMenuState {
  session: AnalysisSession;
  rowKey: string;
  top: number;
  left: number;
}

interface RenameState {
  session: AnalysisSession;
  rowKey: string;
  value: string;
  error: string;
}

export function ProjectSidebar({
  projects,
  recentDocuments,
  localDocuments,
  documentsByProject,
  sessionsByProject = {},
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
  localSessions,
  sessionStatus = 'active',
  selectedSessionId,
  onSelectSession,
  onSessionStatusChange,
  onRenameSession,
  onArchiveSession,
  onRestoreSession,
  onDeleteSession,
  onForkActiveSession,
  onExportSession,
  onCreateSession,
  sessionActionsDisabled = false,
}: ProjectSidebarProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [deletingSession, setDeletingSession] = useState<AnalysisSession | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocusRef = useRef(false);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const renameFinishedRef = useRef(false);

  const hasSessions = recentSessions !== undefined;
  const noProjectSessions =
    localSessions ??
    (recentSessions ?? []).filter(
      (candidate) => !candidate.projectId && candidate.status === sessionStatus,
    );

  useEffect(() => {
    if (!sessionMenu) return;

    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setSessionMenu(null);
      }
    };
    const closeMenuWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionMenu(null);
    };

    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeMenuWithEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeMenuWithEscape);
    };
  }, [sessionMenu]);

  useEffect(() => {
    if (sessionMenu || deletingSession || !restoreMenuFocusRef.current) return;
    if (menuTriggerRef.current?.isConnected) {
      menuTriggerRef.current.focus();
    }
    restoreMenuFocusRef.current = false;
  }, [deletingSession, sessionMenu]);

  useEffect(() => {
    if (!deletingSession) return;
    deleteCancelRef.current?.focus();
    const cancelWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeletingSession(null);
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', cancelWithEscape);
    return () => document.removeEventListener('keydown', cancelWithEscape);
  }, [deletingSession]);

  const startRename = useCallback((sessionToRename: AnalysisSession, rowKey: string) => {
    renameFinishedRef.current = false;
    setRenameState({
      session: sessionToRename,
      rowKey,
      value: sessionToRename.title,
      error: '',
    });
    setSessionMenu(null);
  }, []);

  const finishRename = useCallback(() => {
    if (!renameState || renameFinishedRef.current) return;
    const title = renameState.value.trim();
    if (title.length === 0 || title.length > 80) {
      setRenameState((current) =>
        current
          ? {
              ...current,
              error:
                labels.invalidSessionTitle ??
                'Enter a title between 1 and 80 characters',
            }
          : current,
      );
      return;
    }

    renameFinishedRef.current = true;
    onRenameSession?.(renameState.session.id, title);
    setRenameState(null);
  }, [labels.invalidSessionTitle, onRenameSession, renameState]);

  const renderSession = useCallback(
    (sidebarSession: AnalysisSession, rowKey: string) => {
      if (renameState?.rowKey === rowKey) {
        return (
          <div className={styles.renameRow}>
            <input
              className={styles.inlineInput}
              aria-label={labels.sessionTitle ?? 'Session title'}
              autoFocus
              value={renameState.value}
              onBlur={finishRename}
              onChange={(event) =>
                setRenameState((current) =>
                  current
                    ? { ...current, value: event.target.value, error: '' }
                    : current,
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  finishRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  renameFinishedRef.current = true;
                  setRenameState(null);
                }
              }}
            />
            {renameState.error ? (
              <span className={styles.inlineError} role="alert">
                {renameState.error}
              </span>
            ) : null}
          </div>
        );
      }

      const manageLabel = `${labels.manageSession ?? 'Manage session'}: ${sidebarSession.title}`;
      return (
        <div
          className={styles.sessionRow}
          data-active={sidebarSession.id === selectedSessionId}
        >
          <button
            className={styles.conversationItem}
            data-active={sidebarSession.id === selectedSessionId}
            type="button"
            aria-pressed={sidebarSession.id === selectedSessionId}
            title={sidebarSession.title}
            onClick={() => onSelectSession?.(sidebarSession)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {sidebarSession.status === 'archived' ? 'archive' : 'description'}
            </span>
            <span>{sidebarSession.title}</span>
          </button>
          <button
            className={styles.sessionMenuTrigger}
            type="button"
            aria-label={manageLabel}
            title={manageLabel}
            aria-haspopup="menu"
            aria-expanded={sessionMenu?.rowKey === rowKey}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const menuWidth = 168;
              menuTriggerRef.current = event.currentTarget;
              restoreMenuFocusRef.current = true;
              setSessionMenu({
                session: sidebarSession,
                rowKey,
                top: bounds.bottom + 4,
                left: Math.max(8, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 8)),
              });
            }}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              more_vert
            </span>
          </button>
        </div>
      );
    },
    [
      finishRename,
      labels.manageSession,
      labels.sessionTitle,
      onSelectSession,
      renameState,
      selectedSessionId,
      sessionMenu?.rowKey,
    ],
  );

  return (
    <aside className={styles.projectSidebar}>
      <button
        className={styles.primaryAction}
        data-sidebar-zone="directory-action"
        type="button"
        onClick={onSelectDirectory}
      >
        <span className="material-symbols-rounded" aria-hidden="true">
          create_new_folder
        </span>
        <span>{labels.selectDirectory}</span>
      </button>

      <section
        className={`${styles.sidebarSection} ${styles.projectTreeSection}`}
        data-sidebar-zone="project-tree"
      >
        <div className={styles.sidebarSectionHeader}>
          <h2>{labels.projects}</h2>
          {hasSessions ? (
            <div
              className={styles.sessionStatusControl}
              role="group"
              aria-label={labels.sessionStatus ?? 'Session status'}
            >
              <button
                type="button"
                aria-pressed={sessionStatus === 'active'}
                onClick={() => onSessionStatusChange?.('active')}
              >
                {labels.activeSessions ?? 'Active'}
              </button>
              <button
                type="button"
                aria-pressed={sessionStatus === 'archived'}
                onClick={() => onSessionStatusChange?.('archived')}
              >
                {labels.archivedSessions ?? 'Archived'}
              </button>
            </div>
          ) : null}
        </div>
        <div className={styles.projectTree}>
          <div className={styles.folderGroup}>
            <div className={styles.folderHeaderRow}>
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
              {hasSessions ? (
                <button
                  className={styles.folderCreateSession}
                  type="button"
                  aria-label={`${labels.newSession ?? 'New session'}: ${labels.localDocuments}`}
                  title={`${labels.newSession ?? 'New session'}: ${labels.localDocuments}`}
                  onClick={() => onCreateSession?.(null)}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    add_comment
                  </span>
                </button>
              ) : null}
            </div>
            {localExpanded ? (
              <div className={styles.folderChildren}>
                {hasSessions ? (
                  <SessionList
                    sessions={noProjectSessions}
                    emptyLabel={labels.noConversations}
                    listKey={`local-${sessionStatus}`}
                    renderSession={renderSession}
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
                <div
                  className={styles.folderGroup}
                  key={project.id}
                  data-testid={`project-${project.id}`}
                >
                  <div className={styles.folderHeaderRow}>
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
                          ? sessionStatus === 'active'
                            ? (project.conversationCount ?? projectSessions.length)
                            : (project.archivedConversationCount ?? projectSessions.length)
                          : (project.conversationCount ?? projectDocuments.length)}
                      </span>
                    </button>
                    {hasSessions ? (
                      <button
                        className={styles.folderCreateSession}
                        type="button"
                        aria-label={`${labels.newSession ?? 'New session'}: ${project.name}`}
                        title={`${labels.newSession ?? 'New session'}: ${project.name}`}
                        onClick={() => onCreateSession?.(project.id)}
                      >
                        <span className="material-symbols-rounded" aria-hidden="true">
                          add_comment
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {expanded ? (
                    <div className={styles.folderChildren}>
                      {hasSessions ? (
                        <SessionList
                          sessions={projectSessions}
                          emptyLabel={labels.noConversations}
                          listKey={`project-${project.id}-${sessionStatus}`}
                          renderSession={renderSession}
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

      <section
        className={`${styles.sidebarSection} ${styles.recentSessionsSection}`}
        data-sidebar-zone="recent-sessions"
      >
        <h2>{labels.recentConversations}</h2>
        <div className={styles.sidebarList}>
          {hasSessions ? (
            <SessionList
              sessions={recentSessions ?? []}
              emptyLabel={labels.noConversations}
              listKey="recent"
              renderSession={renderSession}
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

      <div className={styles.sidebarFooter} data-sidebar-zone="language-footer">
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
      </div>

      {sessionMenu ? (
        <div
          className={styles.contextMenu}
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: sessionMenu.top, left: sessionMenu.left, zIndex: 1000 }}
        >
          {sessionMenu.session.status === 'active' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => startRename(sessionMenu.session, sessionMenu.rowKey)}
              >
                {labels.renameSession ?? 'Rename'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  sessionActionsDisabled &&
                  sessionMenu.session.id === selectedSessionId
                }
                onClick={() => {
                  onArchiveSession?.(sessionMenu.session.id);
                  setSessionMenu(null);
                }}
              >
                {labels.archiveSession ?? 'Archive'}
              </button>
              <button
                type="button"
                role="menuitem"
                aria-label={labels.createSessionBranch ?? 'Create session branch'}
                title={labels.createSessionBranch ?? 'Create session branch'}
                disabled={
                  !sessionMenu.session.activeDocumentId ||
                  (sessionActionsDisabled && sessionMenu.session.id === selectedSessionId)
                }
                onClick={() => {
                  onForkActiveSession?.(sessionMenu.session.id);
                  setSessionMenu(null);
                }}
              >
                {labels.createSessionBranch ?? 'Create session branch'}
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRestoreSession?.(sessionMenu.session.id);
                setSessionMenu(null);
              }}
            >
              {labels.restoreSession ?? 'Restore'}
              </button>
          )}
          <button
            type="button"
            role="menuitem"
            aria-label={labels.exportSessionMarkdown ?? 'Export session as Markdown'}
            title={labels.exportSessionMarkdown ?? 'Export session as Markdown'}
            onClick={() => {
              onExportSession?.(sessionMenu.session.id, 'markdown');
              setSessionMenu(null);
            }}
          >
            {labels.exportSessionMarkdown ?? 'Export session as Markdown'}
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label={labels.exportSessionJson ?? 'Export session as JSON'}
            title={labels.exportSessionJson ?? 'Export session as JSON'}
            onClick={() => {
              onExportSession?.(sessionMenu.session.id, 'json');
              setSessionMenu(null);
            }}
          >
            {labels.exportSessionJson ?? 'Export session as JSON'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={
              sessionActionsDisabled &&
              sessionMenu.session.id === selectedSessionId
            }
            onClick={() => {
              setDeletingSession(sessionMenu.session);
              setSessionMenu(null);
            }}
          >
            {labels.deleteSession ?? 'Delete'}
          </button>
        </div>
      ) : null}

      {deletingSession ? (
        <div className={styles.dialogBackdrop}>
          <div
            className={styles.confirmDialog}
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            aria-describedby="delete-session-description"
          >
            <p id="delete-session-title">
              {labels.confirmDelete ?? 'Delete permanently'}: {deletingSession.title}
            </p>
            <p className={styles.dialogDescription} id="delete-session-description">
              {labels.deleteSessionWarning ??
                'This permanently deletes the session and all related data.'}
            </p>
            <div className={styles.confirmActions}>
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={() => setDeletingSession(null)}
              >
                {labels.cancel ?? 'Cancel'}
              </button>
              <button
                type="button"
                data-variant="danger"
                onClick={() => {
                  onDeleteSession?.(deletingSession.id);
                  setDeletingSession(null);
                }}
              >
                <span className="material-symbols-rounded" aria-hidden="true">delete_forever</span>
                <span>{labels.confirmDelete ?? 'Delete permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
