import { useState, useEffect, useRef, useCallback } from 'react';

import type { AnalysisSession } from '@ai-reader/shared';

import styles from './CodeAnalysisComponents.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

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
  /** Legacy: document list (used when recentSessions is not provided). */
  recentDocuments?: SidebarDocument[];
  localDocuments?: SidebarDocument[];
  /** Legacy: documents grouped by project. */
  documentsByProject?: Record<string, SidebarDocument[]>;
  expandedProjectIds?: Set<string>;
  selectedProjectId?: string;
  /** Legacy: selected document id. */
  selectedDocumentId?: string;
  language?: 'zh-CN' | 'en-US';
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
    newSession?: string;
    renameSession?: string;
    archiveSession?: string;
    deleteSession?: string;
    confirmDelete?: string;
    cancel?: string;
  };
  onSelectDirectory?: () => void;
  onToggleProject?: (project: SidebarProject) => void;
  onSelectLocal?: () => void;
  onSelectDocument?: (document: SidebarDocument) => void;
  onLanguageChange?: (language: 'zh-CN' | 'en-US') => void;

  // ── Session props ────────────────────────────────────────────────────────
  /** Recent sessions (replaces recentDocuments when provided). */
  recentSessions?: AnalysisSession[];
  /** Sessions grouped by project id. */
  sessionsByProject?: Record<string, AnalysisSession[]>;
  selectedSessionId?: string;
  onSelectSession?: (session: AnalysisSession) => void;
  onNewSession?: () => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

// ── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  sessionId: string;
  sessionTitle: string;
}

function SessionContextMenu({
  state,
  labels,
  onClose,
  onRename,
  onArchive,
  onDelete,
}: {
  state: ContextMenuState;
  labels: ProjectSidebarProps['labels'];
  onClose: () => void;
  onRename: () => void;
  onArchive: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className={styles.contextMenu}
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 1000 }}
    >
      <button type="button" role="menuitem" onClick={onRename}>
        {labels.renameSession ?? '重命名'}
      </button>
      <button type="button" role="menuitem" onClick={() => { onArchive(state.sessionId); onClose(); }}>
        {labels.archiveSession ?? '归档'}
      </button>
      <button type="button" role="menuitem" onClick={() => { onDelete(state.sessionId); onClose(); }}>
        {labels.deleteSession ?? '删除'}
      </button>
    </div>
  );
}

// ── Delete Confirmation Dialog ───────────────────────────────────────────────

function DeleteConfirmDialog({
  sessionTitle,
  labels,
  onConfirm,
  onCancel,
}: {
  sessionTitle: string;
  labels: ProjectSidebarProps['labels'];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" className={styles.confirmDialog} aria-label={labels.confirmDelete ?? '确认删除'}>
      <p>{`${labels.deleteSession ?? '删除'} "${sessionTitle}"?`}</p>
      <div className={styles.confirmActions}>
        <button type="button" onClick={onCancel}>
          {labels.cancel ?? '取消'}
        </button>
        <button type="button" onClick={onConfirm} data-variant="danger">
          {labels.confirmDelete ?? '确认删除'}
        </button>
      </div>
    </div>
  );
}

// ── Inline Rename Input ─────────────────────────────────────────────────────

function InlineRenameInput({
  defaultValue,
  onConfirm,
  onCancel,
}: {
  defaultValue: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && trimmed !== defaultValue) {
        onConfirm(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== defaultValue) {
          onConfirm(trimmed);
        } else {
          onCancel();
        }
      }}
      className={styles.inlineInput}
      aria-label="Rename session"
    />
  );
}

// ── Session List ─────────────────────────────────────────────────────────────

function SessionList({
  sessions,
  selectedSessionId,
  emptyLabel,
  onSelectSession,
  onContextAction,
}: {
  sessions: AnalysisSession[];
  selectedSessionId?: string;
  emptyLabel: string;
  onSelectSession?: (session: AnalysisSession) => void;
  onContextAction?: (e: React.MouseEvent, session: AnalysisSession) => void;
}) {
  if (sessions.length === 0) return <p className={styles.muted}>{emptyLabel}</p>;

  return (
    <>
      {sessions.map((session) => (
        <button
          className={styles.conversationItem}
          data-active={session.id === selectedSessionId}
          data-status={session.status}
          type="button"
          aria-pressed={session.id === selectedSessionId}
          title={session.title}
          key={session.id}
          onClick={() => onSelectSession?.(session)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextAction?.(e, session);
          }}
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

// ── Document List (legacy) ───────────────────────────────────────────────────

function DocumentList({
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

// ── ProjectSidebar ───────────────────────────────────────────────────────────

export function ProjectSidebar({
  projects,
  recentDocuments = [],
  localDocuments = [],
  documentsByProject = {},
  expandedProjectIds = new Set<string>(),
  selectedProjectId,
  selectedDocumentId,
  language = 'zh-CN',
  labels,
  onSelectDirectory,
  onToggleProject,
  onSelectLocal,
  onSelectDocument,
  onLanguageChange,
  recentSessions,
  sessionsByProject = {},
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onArchiveSession,
  onDeleteSession,
}: ProjectSidebarProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [deletingSession, setDeletingSession] = useState<{ id: string; title: string } | null>(null);

  const isSessionMode = recentSessions !== undefined;

  const handleContextMenu = useCallback((e: React.MouseEvent, session: AnalysisSession) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      sessionId: session.id,
      sessionTitle: session.title,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleRenameStart = useCallback(() => {
    if (contextMenu) {
      setRenamingSessionId(contextMenu.sessionId);
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleRenameConfirm = useCallback(
    (newTitle: string) => {
      if (renamingSessionId && onRenameSession) {
        onRenameSession(renamingSessionId, newTitle);
      }
      setRenamingSessionId(null);
    },
    [renamingSessionId, onRenameSession],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionId(null);
  }, []);

  const handleDeleteRequest = useCallback(
    (sessionId: string) => {
      const allSessions = [
        ...(recentSessions ?? []),
        ...Object.values(sessionsByProject).flat(),
      ];
      const session = allSessions.find((s) => s.id === sessionId);
      if (session) {
        setDeletingSession({ id: session.id, title: session.title });
      }
    },
    [recentSessions, sessionsByProject],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (deletingSession) {
      onDeleteSession?.(deletingSession.id);
    }
    setDeletingSession(null);
  }, [deletingSession, onDeleteSession]);

  const handleDeleteCancel = useCallback(() => {
    setDeletingSession(null);
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────────

  function renderSessionItem(session: AnalysisSession) {
    if (renamingSessionId === session.id) {
      return (
        <div key={session.id} className={styles.renameRow}>
          <InlineRenameInput
            defaultValue={session.title}
            onConfirm={handleRenameConfirm}
            onCancel={handleRenameCancel}
          />
        </div>
      );
    }

    return (
      <button
        className={styles.conversationItem}
        data-active={session.id === selectedSessionId}
        data-status={session.status}
        type="button"
        aria-pressed={session.id === selectedSessionId}
        title={session.title}
        key={session.id}
        onClick={() => onSelectSession?.(session)}
        onContextMenu={(e) => {
          e.preventDefault();
          handleContextMenu(e, session);
        }}
      >
        <span className="material-symbols-rounded" aria-hidden="true">
          {session.status === 'archived' ? 'archive' : 'description'}
        </span>
        <span>{session.title}</span>
      </button>
    );
  }

  function renderSessionList(sessions: AnalysisSession[], emptyLabel: string) {
    if (sessions.length === 0) return <p className={styles.muted}>{emptyLabel}</p>;
    return <>{sessions.map(renderSessionItem)}</>;
  }

  function renderRecentSection() {
    if (isSessionMode) {
      return (
        <section className={styles.sidebarSection}>
          <h2>{labels.recentConversations}</h2>
          <div className={styles.sidebarList}>
            {renderSessionList(recentSessions ?? [], labels.noConversations)}
          </div>
        </section>
      );
    }

    return (
      <section className={styles.sidebarSection}>
        <h2>{labels.recentConversations}</h2>
        <div className={styles.sidebarList}>
          <DocumentList
            documents={recentDocuments}
            selectedDocumentId={selectedDocumentId}
            emptyLabel={labels.noConversations}
            onSelectDocument={onSelectDocument ?? (() => {})}
          />
        </div>
      </section>
    );
  }

  function renderProjectTree() {
    if (isSessionMode) {
      return (
        <section className={`${styles.sidebarSection} ${styles.projectTreeSection}`}>
          <h2>{labels.projects}</h2>
          <div className={styles.projectTree}>
            {projects.length === 0 ? (
              <p className={styles.muted}>{labels.noProjects}</p>
            ) : (
              projects.map((project) => {
                const expanded = expandedProjectIds.has(project.id);
                const projectSessions = sessionsByProject[project.id] ?? [];
                return (
                  <div className={styles.folderGroup} key={project.id}>
                    <button
                      className={styles.folderRow}
                      data-active={project.id === selectedProjectId}
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => onToggleProject?.(project)}
                    >
                      <span className="material-symbols-rounded" aria-hidden="true">
                        {expanded ? 'expand_more' : 'chevron_right'}
                      </span>
                      <span className="material-symbols-rounded" aria-hidden="true">
                        {expanded ? 'folder_open' : 'folder'}
                      </span>
                      <span>{project.name}</span>
                      <span className={styles.folderCount} aria-hidden="true">
                        {project.conversationCount ?? projectSessions.length}
                      </span>
                    </button>
                    {expanded ? (
                      <div className={styles.folderChildren}>
                        {renderSessionList(projectSessions, labels.noConversations)}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </section>
      );
    }

    // Legacy document tree
    return (
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
                onSelectLocal?.();
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
                {localDocuments.length}
              </span>
            </button>
            {localExpanded ? (
              <div className={styles.folderChildren}>
                <DocumentList
                  documents={localDocuments}
                  selectedDocumentId={selectedDocumentId}
                  emptyLabel={labels.noConversations}
                  onSelectDocument={onSelectDocument ?? (() => {})}
                />
              </div>
            ) : null}
          </div>

          {projects.length === 0 ? (
            <p className={styles.muted}>{labels.noProjects}</p>
          ) : (
            projects.map((project) => {
              const expanded = expandedProjectIds.has(project.id);
              const projectDocuments = documentsByProject[project.id] ?? [];
              return (
                <div className={styles.folderGroup} key={project.id}>
                  <button
                    className={styles.folderRow}
                    data-active={project.id === selectedProjectId}
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => onToggleProject?.(project)}
                  >
                    <span className="material-symbols-rounded" aria-hidden="true">
                      {expanded ? 'expand_more' : 'chevron_right'}
                    </span>
                    <span className="material-symbols-rounded" aria-hidden="true">
                      {expanded ? 'folder_open' : 'folder'}
                    </span>
                    <span>{project.name}</span>
                    <span className={styles.folderCount} aria-hidden="true">
                      {project.conversationCount ?? projectDocuments.length}
                    </span>
                  </button>
                  {expanded ? (
                    <div className={styles.folderChildren}>
                      <DocumentList
                        documents={projectDocuments}
                        selectedDocumentId={selectedDocumentId}
                        emptyLabel={labels.noConversations}
                        onSelectDocument={onSelectDocument ?? (() => {})}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    );
  }

  return (
    <aside className={styles.projectSidebar}>
      <button className={styles.primaryAction} type="button" onClick={onSelectDirectory}>
        <span className="material-symbols-rounded" aria-hidden="true">
          create_new_folder
        </span>
        <span>{labels.selectDirectory}</span>
      </button>

      {onNewSession ? (
        <button className={styles.secondaryAction} type="button" onClick={onNewSession}>
          <span className="material-symbols-rounded" aria-hidden="true">
            add
          </span>
          <span>{labels.newSession ?? '新建会话'}</span>
        </button>
      ) : null}

      {renderRecentSection()}
      {renderProjectTree()}

      <label className={styles.languageControl}>
        <span>{labels.language}</span>
        <select
          aria-label={labels.language}
          value={language}
          onChange={(event) => onLanguageChange?.(event.target.value as 'zh-CN' | 'en-US')}
        >
          <option value="zh-CN">{labels.chinese}</option>
          <option value="en-US">{labels.english}</option>
        </select>
      </label>

      {/* Context menu - always visible in session mode */}
      {contextMenu && isSessionMode ? (
        <SessionContextMenu
          state={contextMenu}
          labels={labels}
          onClose={handleCloseContextMenu}
          onRename={handleRenameStart}
          onArchive={(id) => onArchiveSession?.(id)}
          onDelete={handleDeleteRequest}
        />
      ) : null}

      {/* Delete confirmation dialog */}
      {deletingSession ? (
        <DeleteConfirmDialog
          sessionTitle={deletingSession.title}
          labels={labels}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      ) : null}
    </aside>
  );
}
