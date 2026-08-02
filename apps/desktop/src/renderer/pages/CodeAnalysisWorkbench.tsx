import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnalysisBranch,
  AnalysisExportFormat,
  AnalysisSession,
  AnalysisSessionStatus,
  AnalysisTurn,
  CodeAnalysisDocumentData,
  CodeAnalysisProjectData,
} from '@ai-reader/shared';

import {
  AnalysisMarkdownViewer,
  AnalysisPromptBox,
  AnnotationSidebar,
  ConversationTimeline,
  ProjectSidebar,
  ToolTraceTimeline,
} from '../components/code-analysis';
import { ReplyActions } from '../components/code-analysis/ReplyActions';
import type { AnalysisAnnotationItem, ToolTraceItem } from '../components/code-analysis';
import AppTitleBar from '../components/common/AppTitleBar';
import type { AnnotationDef, SourceSelectionRange } from '../components/common/MarkdownRenderer';
import ThemeToggle from '../components/common/ThemeToggle';
import componentStyles from '../components/code-analysis/CodeAnalysisComponents.module.css';
import { codeAnalysisText } from './code-analysis-i18n';
import type { AppLanguage } from './code-analysis-i18n';
import styles from './CodeAnalysisWorkbench.module.css';

type CodeProject = Pick<
  CodeAnalysisProjectData,
  'id' | 'name' | 'conversationCount' | 'archivedConversationCount'
>;
type AnalysisDocument = CodeAnalysisDocumentData;

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  state: 'pending' | 'complete' | 'error';
  documentId?: string;
}

function turnToAnalysisDocument(
  turn: AnalysisTurn,
  projectId: string | null,
): AnalysisDocument {
  return {
    id: turn.id,
    projectId,
    goal: turn.goal,
    contentMarkdown: turn.contentMarkdown,
    status: turn.status,
    modelId: turn.modelId,
    toolCallCount: turn.toolCallCount,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
  };
}

/**
 * Scrolls the rendered <mark> for an annotation into view and focuses it.
 * Marks carry `data-annotation-ids` as a comma-separated list; match by exact
 * token so `ann-1` never matches `ann-10`.
 */
function focusAnnotationMark(annotationId: string): boolean {
  const marks = document.querySelectorAll<HTMLElement>('mark[data-annotation-ids]');
  for (const mark of marks) {
    const ids = (mark.dataset.annotationIds ?? '').split(',');
    if (ids.includes(annotationId)) {
      mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
      mark.focus();
      return true;
    }
  }
  return false;
}

export default function CodeAnalysisWorkbench() {
  const [language, setLanguage] = useState<AppLanguage>('en-US');
  const [projects, setProjects] = useState<CodeProject[]>([]);
  const [recentDocuments, setRecentDocuments] = useState<AnalysisDocument[]>([]);
  const [localDocuments, setLocalDocuments] = useState<AnalysisDocument[]>([]);
  const [documentsByProject, setDocumentsByProject] = useState<
    Record<string, AnalysisDocument[]>
  >({});
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const [project, setProject] = useState<CodeProject | null>(null);
  const [document, setDocument] = useState<AnalysisDocument | null>(null);
  const currentDocumentIdRef = useRef<string | undefined>(undefined);
  const [readerViewport, setReaderViewport] = useState<HTMLElement | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [goal, setGoal] = useState('');
  const [traces, setTraces] = useState<ToolTraceItem[]>([]);
  const [annotations, setAnnotations] = useState<AnalysisAnnotationItem[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | undefined>();

  // Annotations with valid source offsets, grouped by the turn (analysis
  // document) they belong to, ready for MarkdownRenderer highlighting. Entries
  // without usable offsets are skipped so stale data never mis-highlights.
  const annotationsByDocument = useMemo(() => {
    const map = new Map<string, AnnotationDef[]>();
    for (const ann of annotations) {
      if (!ann.analysisDocumentId) continue;
      if (!Number.isInteger(ann.anchorStartOffset) || !Number.isInteger(ann.anchorEndOffset)) continue;
      if (ann.anchorStartOffset! >= ann.anchorEndOffset!) continue;
      const list = map.get(ann.analysisDocumentId) ?? [];
      list.push({
        id: ann.id,
        startOffset: ann.anchorStartOffset!,
        endOffset: ann.anchorEndOffset!,
      });
      map.set(ann.analysisDocumentId, list);
    }
    return map;
  }, [annotations]);

  const handleAnnotationClick = useCallback((annotationId: string) => {
    // Activating the annotation expands the matching card in the sidebar.
    setActiveAnnotationId(annotationId);
  }, []);

  const handleViewSource = useCallback((annotationId: string) => {
    setActiveAnnotationId(annotationId);
    focusAnnotationMark(annotationId);
  }, []);

  const handleDeleteAnnotation = useCallback(
    async (annotationId: string) => {
      try {
        await window.api.codeAnalysis.deleteAnnotation(annotationId);
        setAnnotations((current) => current.filter((item) => item.id !== annotationId));
        setActiveAnnotationId((current) => (current === annotationId ? undefined : current));
      } catch (error) {
        setStatus(
          error instanceof Error ? error.message : codeAnalysisText[language].analysisFailed,
        );
      }
    },
    [language],
  );
  const [selectedText, setSelectedText] = useState('');
  const [selectedSourceRange, setSelectedSourceRange] =
    useState<SourceSelectionRange | undefined>();
  const [comment, setComment] = useState('');
  const commentComposerRef = useRef<HTMLDivElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');
  const messageSequence = useRef(0);
  const viewRequestSequence = useRef(0);
  const text = codeAnalysisText[language];

  // Session state
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [sessionStatus, setSessionStatus] = useState<AnalysisSessionStatus>('active');
  const sessionStatusRef = useRef<AnalysisSessionStatus>('active');
  const [localSessions, setLocalSessions] = useState<AnalysisSession[]>([]);
  const [sessionsByProject, setSessionsByProject] = useState<
    Record<string, AnalysisSession[]>
  >({});
  const sessionListRequestSequence = useRef(0);
  const [branches, setBranches] = useState<AnalysisBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AnalysisTurn[]>([]);
  const [isForkingSession, setIsForkingSession] = useState(false);

  useEffect(() => {
    currentDocumentIdRef.current = document?.id;
  }, [document?.id]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.api.codeAnalysis.listProjects(),
      window.api.codeAnalysis.listRecentDocuments(),
      window.api.codeAnalysis.listDocuments(null),
      window.api.settings.getLanguage(),
      window.api.codeAnalysis.listRecentSessions(20),
      window.api.codeAnalysis.listSessions({ projectId: null, status: 'active' }),
    ])
      .then(([
        savedProjects,
        savedRecentDocuments,
        savedLocalDocuments,
        savedLanguage,
        savedSessions,
        savedLocalSessions,
      ]) => {
        if (!active) return;
        setProjects(savedProjects);
        setRecentDocuments(savedRecentDocuments);
        setLocalDocuments(savedLocalDocuments);
        setLanguage(savedLanguage);
        setSessions(savedSessions);
        if (sessionStatusRef.current === 'active') {
          setLocalSessions(savedLocalSessions);
        }
      })
      .catch((error) => {
        if (active) setStatus(error instanceof Error ? error.message : 'Unable to load settings');
      });
    return () => {
      active = false;
    };
  }, []);

  const loadAnnotations = useCallback(async (documentId: string) => {
    const items = await window.api.codeAnalysis.listAnnotations(documentId);
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        messages: await window.api.codeAnalysis.listAnnotationMessages(item.id),
      })),
    );
  }, []);

  const handleVisibleDocument = useCallback(
    async (documentId: string) => {
      if (currentDocumentIdRef.current === documentId) return;
      const visibleTurn = turns.find((turn) => turn.id === documentId);
      if (!visibleTurn) return;

      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      currentDocumentIdRef.current = documentId;
      setDocument(turnToAnalysisDocument(visibleTurn, session?.projectId ?? null));
      setActiveAnnotationId(undefined);
      setSelectedText('');
      setSelectedSourceRange(undefined);
      setComment('');

      const [nextTraces, nextAnnotations] = await Promise.all([
        window.api.codeAnalysis.listTraces(documentId),
        loadAnnotations(documentId),
      ]);
      if (requestId === viewRequestSequence.current) {
        setTraces(nextTraces);
        setAnnotations(nextAnnotations);
      }
    },
    [loadAnnotations, session?.projectId, turns],
  );

  // ── Session management ────────────────────────────────────────────────────

  const updateSessionInCollections = useCallback((updated: AnalysisSession) => {
    setSessions((current) =>
      current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
    setLocalSessions((current) =>
      current.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    );
    setSessionsByProject((current) =>
      Object.fromEntries(
        Object.entries(current).map(([projectId, projectSessions]) => [
          projectId,
          projectSessions.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        ]),
      ),
    );
  }, []);

  const removeSessionFromVisibleCollections = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((candidate) => candidate.id !== sessionId));
    setLocalSessions((current) =>
      current.filter((candidate) => candidate.id !== sessionId),
    );
    setSessionsByProject((current) =>
      Object.fromEntries(
        Object.entries(current).map(([projectId, projectSessions]) => [
          projectId,
          projectSessions.filter((candidate) => candidate.id !== sessionId),
        ]),
      ),
    );
  }, []);

  const addSessionToVisibleCollections = useCallback((created: AnalysisSession) => {
    setSessions((current) => [
      created,
      ...current.filter((candidate) => candidate.id !== created.id),
    ].slice(0, 20));
    if (created.projectId === null) {
      setLocalSessions((current) => [
        created,
        ...current.filter((candidate) => candidate.id !== created.id),
      ]);
      return;
    }
    setSessionsByProject((current) => {
      const projectSessions = current[created.projectId!];
      if (!projectSessions) return current;
      return {
        ...current,
        [created.projectId!]: [
          created,
          ...projectSessions.filter((candidate) => candidate.id !== created.id),
        ],
      };
    });
  }, []);

  const changeSessionStatus = useCallback(
    async (nextStatus: AnalysisSessionStatus) => {
      if (nextStatus === sessionStatus) return;

      sessionListRequestSequence.current += 1;
      const requestId = sessionListRequestSequence.current;
      const previousLocalSessions = localSessions;
      const previousSessionsByProject = sessionsByProject;
      sessionStatusRef.current = nextStatus;
      setSessionStatus(nextStatus);
      setLocalSessions([]);
      setSessionsByProject({});
      try {
        const expandedProjectIdList = Array.from(expandedProjectIds);
        const [nextLocalSessions, ...projectSessionLists] = await Promise.all([
          window.api.codeAnalysis.listSessions({
            projectId: null,
            status: nextStatus,
          }),
          ...expandedProjectIdList.map((projectId) =>
            window.api.codeAnalysis.listSessions({
              projectId,
              status: nextStatus,
            }),
          ),
        ]);
        if (requestId !== sessionListRequestSequence.current) return;

        setLocalSessions(nextLocalSessions);
        setSessionsByProject((current) => ({
          ...current,
          ...Object.fromEntries(
            expandedProjectIdList.map((projectId, index) => [
              projectId,
              projectSessionLists[index],
            ]),
          ),
        }));
      } catch (error) {
        if (requestId !== sessionListRequestSequence.current) return;
        sessionStatusRef.current = sessionStatus;
        setSessionStatus((current) => (current === nextStatus ? sessionStatus : current));
        setLocalSessions(previousLocalSessions);
        setSessionsByProject(previousSessionsByProject);
        setStatus(error instanceof Error ? error.message : 'Unable to load sessions');
      }
    },
    [
      expandedProjectIds,
      localSessions,
      sessionStatus,
      sessionsByProject,
    ],
  );

  const selectSession = useCallback(
    async (nextSession: AnalysisSession) => {
      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      setSession(nextSession);
      setActiveBranchId(nextSession.activeBranchId);
      setDocument(null);
      setMessages([]);
      setTraces([]);
      setAnnotations([]);
      setActiveAnnotationId(undefined);
      setSelectedText('');
      setSelectedSourceRange(undefined);
      setComment('');

      try {
        const detail = await window.api.codeAnalysis.getSession(nextSession.id);
        if (requestId !== viewRequestSequence.current || !detail) return;

        setBranches(detail.branches);
        setTurns(detail.turns);

        // Build messages from turns
        const turnMessages: ConversationMessage[] = [];
        for (const turn of detail.turns) {
          turnMessages.push({
            id: `turn-user-${turn.id}`,
            role: 'user',
            content: turn.goal,
            state: 'complete',
          });
          turnMessages.push({
            id: `turn-assistant-${turn.id}`,
            role: 'assistant',
            content: turn.contentMarkdown,
            state: turn.status === 'failed' ? 'error' : 'complete',
            documentId: turn.id,
          });
        }
        setMessages(turnMessages);

        // Restore the session's active document, with the final turn as a legacy fallback.
        if (detail.turns.length > 0) {
          const activeTurn =
            detail.turns.find((turn) => turn.id === detail.session.activeDocumentId) ??
            detail.turns[detail.turns.length - 1];
          setDocument(turnToAnalysisDocument(activeTurn, detail.session.projectId));
          const [nextTraces, nextAnnotations] = await Promise.all([
            window.api.codeAnalysis.listTraces(activeTurn.id),
            loadAnnotations(activeTurn.id),
          ]);
          if (requestId === viewRequestSequence.current) {
            setTraces(nextTraces);
            setAnnotations(nextAnnotations);
          }
        }
      } catch (error) {
        if (requestId !== viewRequestSequence.current) return;
        setStatus(error instanceof Error ? error.message : 'Unable to load session');
      }
    },
    [loadAnnotations],
  );

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      const updated = await window.api.codeAnalysis.renameSession({ sessionId, title });
      updateSessionInCollections(updated);
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to rename session');
    }
  }, [session, updateSessionInCollections]);

  const archiveSession = useCallback(async (sessionId: string) => {
    try {
      const updated = await window.api.codeAnalysis.archiveSession(sessionId);
      removeSessionFromVisibleCollections(sessionId);
      if (updated.projectId) {
        setProjects((current) =>
          current.map((candidate) =>
            candidate.id === updated.projectId
              ? {
                  ...candidate,
                  conversationCount: Math.max(0, (candidate.conversationCount ?? 0) - 1),
                  archivedConversationCount: (candidate.archivedConversationCount ?? 0) + 1,
                }
              : candidate,
          ),
        );
      }
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to archive session');
    }
  }, [removeSessionFromVisibleCollections, session]);

  const restoreSession = useCallback(async (sessionId: string) => {
    try {
      const updated = await window.api.codeAnalysis.restoreSession(sessionId);
      removeSessionFromVisibleCollections(sessionId);
      setSessions((current) => [
        updated,
        ...current.filter((candidate) => candidate.id !== sessionId),
      ].slice(0, 20));
      if (updated.projectId) {
        setProjects((current) =>
          current.map((candidate) =>
            candidate.id === updated.projectId
              ? {
                  ...candidate,
                  conversationCount: (candidate.conversationCount ?? 0) + 1,
                  archivedConversationCount: Math.max(
                    0,
                    (candidate.archivedConversationCount ?? 0) - 1,
                  ),
                }
              : candidate,
          ),
        );
      }
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to restore session');
    }
  }, [removeSessionFromVisibleCollections, session]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const sessionToDelete =
      (session?.id === sessionId ? session : null) ??
      sessions.find((candidate) => candidate.id === sessionId) ??
      localSessions.find((candidate) => candidate.id === sessionId) ??
      Object.values(sessionsByProject)
        .flat()
        .find((candidate) => candidate.id === sessionId);
    const sourceCollection =
      (localSessions.some((candidate) => candidate.id === sessionId)
        ? localSessions
        : Object.values(sessionsByProject).find((projectSessions) =>
            projectSessions.some((candidate) => candidate.id === sessionId),
          )) ??
      (sessions.some((candidate) => candidate.id === sessionId) ? sessions : []);
    const deletedIndex = sourceCollection.findIndex(
      (candidate) => candidate.id === sessionId,
    );
    const adjacentSession =
      deletedIndex >= 0
        ? sourceCollection[deletedIndex + 1] ?? sourceCollection[deletedIndex - 1] ?? null
        : null;
    try {
      await window.api.codeAnalysis.deleteSession({ sessionId, confirmed: true });
      removeSessionFromVisibleCollections(sessionId);
      if (sessionToDelete?.projectId) {
        setProjects((current) =>
          current.map((candidate) =>
            candidate.id === sessionToDelete.projectId
              ? sessionToDelete.status === 'active'
                ? {
                    ...candidate,
                    conversationCount: Math.max(0, (candidate.conversationCount ?? 0) - 1),
                  }
                : {
                    ...candidate,
                    archivedConversationCount: Math.max(
                      0,
                      (candidate.archivedConversationCount ?? 0) - 1,
                    ),
                  }
              : candidate,
          ),
        );
      }
      if (session?.id === sessionId) {
        if (adjacentSession) {
          setProject(
            adjacentSession.projectId
              ? projects.find((candidate) => candidate.id === adjacentSession.projectId) ??
                  null
              : null,
          );
          await selectSession(adjacentSession);
        } else {
          setSession(null);
          setBranches([]);
          setActiveBranchId(null);
          setTurns([]);
          setMessages([]);
          setTraces([]);
          setAnnotations([]);
          setActiveAnnotationId(undefined);
          setDocument(null);
          setSelectedText('');
          setSelectedSourceRange(undefined);
          setComment('');
          setGoal('');
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete session');
    }
  }, [
    localSessions,
    projects,
    removeSessionFromVisibleCollections,
    selectSession,
    session,
    sessions,
    sessionsByProject,
  ]);

  // ── Branch management ─────────────────────────────────────────────────────

  const checkoutTurn = useCallback(async (turn: AnalysisTurn) => {
    if (!session) return;
    try {
      await window.api.codeAnalysis.checkoutTurn({
        sessionId: session.id,
        branchId: turn.branchId,
        documentId: turn.id,
      });
      // Reload session detail
      const detail = await window.api.codeAnalysis.getSession(session.id);
      if (detail) {
        setSession(detail.session);
        setBranches(detail.branches);
        setTurns(detail.turns);
        setActiveBranchId(detail.session.activeBranchId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to checkout turn');
    }
  }, [session]);

  const switchBranch = useCallback(async (branchId: string) => {
    if (!session) return;
    try {
      await window.api.codeAnalysis.switchBranch({
        sessionId: session.id,
        branchId,
      });
      setActiveBranchId(branchId);
      // Reload session detail
      const detail = await window.api.codeAnalysis.getSession(session.id);
      if (detail) {
        setTurns(detail.turns);
        setSession(detail.session);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to switch branch');
    }
  }, [session]);

  const renameBranch = useCallback(async (branchId: string, name: string) => {
    if (!session) return;
    try {
      const updated = await window.api.codeAnalysis.renameBranch({
        sessionId: session.id,
        branchId,
        name,
      });
      setBranches((current) =>
        current.map((b) => (b.id === branchId ? updated : b)),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to rename branch');
    }
  }, [session]);

  const forkSession = useCallback(async (documentId: string) => {
    if (!session || session.status === 'archived' || isRunning || isForkingSession) return;
    try {
      setIsForkingSession(true);
      const forkedSession = await window.api.codeAnalysis.forkSession({
        sessionId: session.id,
        documentId,
      });
      addSessionToVisibleCollections(forkedSession);
      if (forkedSession.projectId) {
        setProjects((current) =>
          current.map((candidate) =>
            candidate.id === forkedSession.projectId
              ? { ...candidate, conversationCount: (candidate.conversationCount ?? 0) + 1 }
              : candidate,
          ),
        );
      }
      setProject(
        forkedSession.projectId
          ? projects.find((candidate) => candidate.id === forkedSession.projectId) ?? null
          : null,
      );
      await selectSession(forkedSession);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to create branch');
    } finally {
      setIsForkingSession(false);
    }
  }, [addSessionToVisibleCollections, isForkingSession, isRunning, projects, selectSession, session]);

  const clearDocumentState = useCallback(() => {
    setDocument(null);
    setMessages([]);
    setTraces([]);
    setAnnotations([]);
    setActiveAnnotationId(undefined);
    setSelectedText('');
    setSelectedSourceRange(undefined);
    setComment('');
  }, []);

  const startSessionDraft = useCallback(
    (nextProject: CodeProject | null) => {
      setProject(nextProject);
      setSession(null);
      setBranches([]);
      setActiveBranchId(null);
      setTurns([]);
      clearDocumentState();
      setGoal('');
      if (sessionStatusRef.current !== 'active') {
        void changeSessionStatus('active');
      }
    },
    [changeSessionStatus, clearDocumentState],
  );

  const selectProject = useCallback(
    async (nextProject: CodeProject) => {
      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      const requestedSessionStatus = sessionStatus;
      if (project?.id !== nextProject.id) {
        startSessionDraft(nextProject);
      }
      const isExpanded = expandedProjectIds.has(nextProject.id);
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        if (next.has(nextProject.id)) next.delete(nextProject.id);
        else next.add(nextProject.id);
        return next;
      });
      if (isExpanded) return;
      const [nextDocuments, nextSessions] = await Promise.all([
        window.api.codeAnalysis.listDocuments(nextProject.id),
        window.api.codeAnalysis.listSessions({
          projectId: nextProject.id,
          status: sessionStatus,
        }),
      ]);
      if (requestId === viewRequestSequence.current) {
        setDocumentsByProject((current) => ({
          ...current,
          [nextProject.id]: nextDocuments,
        }));
      }
      if (
        requestId === viewRequestSequence.current &&
        requestedSessionStatus === sessionStatusRef.current
      ) {
        setSessionsByProject((current) => ({
          ...current,
          [nextProject.id]: nextSessions,
        }));
      }
    },
    [expandedProjectIds, project?.id, sessionStatus, startSessionDraft],
  );

  const selectDocument = useCallback(
    async (nextDocument: AnalysisDocument) => {
      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      setDocument(nextDocument);
      setActiveAnnotationId(undefined);
      setMessages([
        {
          id: `history-user-${nextDocument.id}`,
          role: 'user',
          content: nextDocument.goal,
          state: 'complete',
        },
        {
          id: `history-assistant-${nextDocument.id}`,
          role: 'assistant',
          content: nextDocument.contentMarkdown,
          state: nextDocument.status === 'failed' ? 'error' : 'complete',
          documentId: nextDocument.id,
        },
      ]);
      setSelectedText('');
      setSelectedSourceRange(undefined);
      setComment('');
      const [nextTraces, nextAnnotations] = await Promise.all([
        window.api.codeAnalysis.listTraces(nextDocument.id),
        loadAnnotations(nextDocument.id),
      ]);
      if (requestId === viewRequestSequence.current) {
        setTraces(nextTraces);
        setAnnotations(nextAnnotations);
      }
    },
    [loadAnnotations],
  );

  const selectDirectory = useCallback(async () => {
    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    const requestedSessionStatus = sessionStatus;
    const result = await window.api.dialog.openDirectory();
    if (result.canceled || !result.filePaths[0]) return;
    if (requestId !== viewRequestSequence.current) return;

    const created = await window.api.codeAnalysis.createProject(result.filePaths[0]);
    const nextProject = {
      id: created.id,
      name: created.name,
      conversationCount: created.conversationCount,
    };
    setProjects((current) => [
      nextProject,
      ...current.filter((item) => item.id !== nextProject.id),
    ]);
    if (requestId !== viewRequestSequence.current) return;
    startSessionDraft(nextProject);
    setExpandedProjectIds((current) => new Set(current).add(nextProject.id));
    const [nextDocuments, nextSessions] = await Promise.all([
      window.api.codeAnalysis.listDocuments(nextProject.id),
      window.api.codeAnalysis.listSessions({
        projectId: nextProject.id,
        status: sessionStatus,
      }),
    ]);
    if (requestId !== viewRequestSequence.current) return;
    setDocumentsByProject((current) => ({
      ...current,
      [nextProject.id]: nextDocuments,
    }));
    if (requestedSessionStatus === sessionStatusRef.current) {
      setSessionsByProject((current) => ({
        ...current,
        [nextProject.id]: nextSessions,
      }));
    }
    setStatus(text.directorySelected);
  }, [sessionStatus, startSessionDraft, text.directorySelected]);

  const runAnalysis = useCallback(async () => {
    if (!goal.trim()) return;

    const submittedGoal = goal.trim();
    const isNewSession = session === null;
    const requestedSessionStatus = sessionStatus;
    messageSequence.current += 1;
    const userMessageId = `user-${messageSequence.current}`;
    messageSequence.current += 1;
    const assistantMessageId = `assistant-${messageSequence.current}`;
    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    setMessages((current) => [
      ...current,
      {
        id: userMessageId,
        role: 'user',
        content: submittedGoal,
        state: 'complete',
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        state: 'pending',
      },
    ]);
    setGoal('');
    setTraces([]);
    setAnnotations([]);
    setActiveAnnotationId(undefined);
    setIsRunning(true);
    setStatus(text.runningAnalysis);
    try {
      const result = await window.api.codeAnalysis.runTurn({
        sessionId: session?.id,
        projectId: project?.id ?? undefined,
        parentDocumentId: turns.length > 0 ? turns[turns.length - 1].id : undefined,
        goal: submittedGoal,
      });
      if (requestId !== viewRequestSequence.current) return;

      // Update session state
      setSession(result.session);
      setBranches((current) => {
        const exists = current.some((b) => b.id === result.branch.id);
        return exists ? current.map((b) => (b.id === result.branch.id ? result.branch : b)) : [...current, result.branch];
      });
      setActiveBranchId(result.session.activeBranchId);
      setTurns((current) => [...current, result.turn]);

      // Create a mock document from the turn for export compatibility
      const turnDocument: AnalysisDocument = {
        id: result.turn.id,
        projectId: result.session.projectId,
        goal: result.turn.goal,
        contentMarkdown: result.turn.contentMarkdown,
        status: result.turn.status,
        modelId: result.turn.modelId,
        toolCallCount: result.turn.toolCallCount,
        createdAt: result.turn.createdAt,
        updatedAt: result.turn.updatedAt,
      };
      setDocument(turnDocument);
      // The document now points at the new turn; stale selection state from the
      // previous turn would anchor annotations to wrong offsets, so clear it.
      setSelectedText('');
      setSelectedSourceRange(undefined);

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: result.turn.contentMarkdown,
                state: result.turn.status === 'failed' ? 'error' : 'complete',
                documentId: result.turn.id,
              }
            : message,
        ),
      );

      // Update sessions list
      setSessions((current) => {
        const exists = current.some((s) => s.id === result.session.id);
        if (exists) {
          return current.map((s) => (s.id === result.session.id ? result.session : s));
        }
        return [result.session, ...current].slice(0, 20);
      });

      // Update project conversation count. Bucket writes are gated on the status
      // filter that was active when this turn was submitted, so a completed turn
      // does not leak into buckets rendered under a newer status filter.
      if (result.session.projectId) {
        if (requestedSessionStatus === sessionStatusRef.current) {
          setSessionsByProject((current) => {
            const projectSessions = current[result.session.projectId!] ?? [];
            return {
              ...current,
              [result.session.projectId!]: [
                result.session,
                ...projectSessions.filter((item) => item.id !== result.session.id),
              ],
            };
          });
        }
        if (isNewSession) {
          setProjects((current) =>
            current.map((item) =>
              item.id === result.session.projectId
                ? { ...item, conversationCount: (item.conversationCount ?? 0) + 1 }
                : item,
            ),
          );
        }
      } else if (requestedSessionStatus === sessionStatusRef.current) {
        setLocalSessions((current) => [
          result.session,
          ...current.filter((item) => item.id !== result.session.id),
        ]);
      }

      const [nextTraces, nextAnnotations] = await Promise.all([
        window.api.codeAnalysis.listTraces(result.turn.id),
        loadAnnotations(result.turn.id),
      ]);
      if (requestId !== viewRequestSequence.current) return;
      setTraces(nextTraces);
      setAnnotations(nextAnnotations);
      setStatus(text.analysisCompleted);
    } catch (err) {
      if (requestId !== viewRequestSequence.current) return;
      const errorMessage = err instanceof Error ? err.message : text.analysisFailed;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: errorMessage,
                state: 'error',
              }
            : message,
        ),
      );
      setStatus(errorMessage);
      // runTurn persists the session before analysis; if the first turn fails
      // the session still exists in the DB. Re-sync the overview so the recent
      // list and project counts stay consistent with the database.
      if (isNewSession) {
        void Promise.all([
          window.api.codeAnalysis.listRecentSessions(20),
          window.api.codeAnalysis.listProjects(),
        ])
          .then(([nextSessions, nextProjects]) => {
            if (requestId !== viewRequestSequence.current) return;
            setSessions(nextSessions);
            setProjects(nextProjects);
          })
          .catch(() => undefined);
      }
    } finally {
      setIsRunning(false);
    }
  }, [goal, loadAnnotations, project, session, sessionStatus, turns, text.analysisCompleted, text.analysisFailed, text.runningAnalysis]);

  const selectAnalysisText = useCallback(
    async (
      message: ConversationMessage,
      text: string,
      sourceRange?: SourceSelectionRange,
    ) => {
    if (!message.documentId) return;
    const selectedTurn = turns.find((turn) => turn.id === message.documentId);
    if (!selectedTurn) return;

    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    setDocument(turnToAnalysisDocument(selectedTurn, session?.projectId ?? null));
    setSelectedText(text);
    setSelectedSourceRange(sourceRange);
    setStatus(codeAnalysisText[language].textSelected);
    const [nextTraces, nextAnnotations] = await Promise.all([
      window.api.codeAnalysis.listTraces(message.documentId),
      loadAnnotations(message.documentId),
    ]);
    if (requestId === viewRequestSequence.current) {
      setTraces(nextTraces);
      setAnnotations(nextAnnotations);
    }
  },
    [language, loadAnnotations, session?.projectId, turns],
  );

  useEffect(() => {
    if (!selectedText) return;
    commentComposerRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedText]);

  const createAnnotation = useCallback(async () => {
    if (!document || !selectedText || !comment.trim()) return;

    const requestId = viewRequestSequence.current;
    const annotationPayload = selectedSourceRange
      ? {
          analysisDocumentId: document.id,
          selectedText,
          sourceStartOffset: selectedSourceRange.sourceStartOffset,
          sourceEndOffset: selectedSourceRange.sourceEndOffset,
          question: comment.trim(),
        }
      : {
          analysisDocumentId: document.id,
          selectedText,
          question: comment.trim(),
        };
    const annotation = await window.api.codeAnalysis.createAnnotation(annotationPayload);
    if (requestId !== viewRequestSequence.current) {
      try {
        await window.api.codeAnalysis.replyToAnnotation(annotation.id);
      } catch {
        // The backend persists the failed status for this now-background annotation.
      }
      return;
    }
    setAnnotations((current) => [...current, annotation]);
    setActiveAnnotationId(annotation.id);
    setComment('');
    setSelectedText('');
    setSelectedSourceRange(undefined);
    setStatus(text.replying);

    try {
      const messages = await window.api.codeAnalysis.replyToAnnotation(annotation.id);
      const refreshed = await loadAnnotations(document.id);
      if (requestId !== viewRequestSequence.current) return;
      setAnnotations(
        refreshed.length > 0
          ? refreshed
          : [
              {
                ...annotation,
                status: messages.some((message) => message.role === 'assistant')
                  ? 'answered'
                  : annotation.status,
                messages,
              },
            ],
      );
      setStatus(text.commentAnswered);
    } catch (error) {
      const refreshed = await loadAnnotations(document.id);
      if (requestId !== viewRequestSequence.current) return;
      setAnnotations(
        refreshed.length > 0
          ? refreshed
          : [{ ...annotation, status: 'failed', messages: [] }],
      );
      setStatus(error instanceof Error ? error.message : text.analysisFailed);
    }
  }, [
    comment,
    document,
    loadAnnotations,
    selectedSourceRange,
    selectedText,
    text.analysisFailed,
    text.commentAnswered,
    text.replying,
  ]);

  const changeLanguage = useCallback(async (nextLanguage: AppLanguage) => {
    const previousLanguage = language;
    setLanguage(nextLanguage);
    try {
      await window.api.settings.setLanguage(nextLanguage);
    } catch (error) {
      setLanguage(previousLanguage);
      setStatus(error instanceof Error ? error.message : 'Unable to save language');
    }
  }, [language]);

  // 导出：先生成内容制品，再通过通用保存通道落盘
  const handleExport = useCallback(
    async (documentId: string, format: AnalysisExportFormat) => {
      try {
        const artifact = await window.api.codeAnalysis.exportDocument(documentId, format);
        const saved = await window.api.dialog.saveFile({
          defaultFileName: artifact.defaultFileName,
          content: artifact.content,
          filters:
            format === 'markdown'
              ? [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
              : [{ name: 'JSON', extensions: ['json'] }],
        });
        if (saved.canceled) return;
        setStatus(text.exportedTo(saved.filePath ?? ''));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : text.exportFailed);
      }
    },
    [text.exportFailed, text.exportedTo],
  );

  const activeBranch = branches.find((branch) => branch.id === activeBranchId);
  const contextBreadcrumbs = [
    {
      id: 'workspace' as const,
      label: text.contextWorkspace,
      onNavigate: () => startSessionDraft(null),
    },
    ...(project
      ? [{ id: 'project' as const, label: project.name, onNavigate: () => startSessionDraft(project) }]
      : [{ id: 'project' as const, label: text.contextLocal, onNavigate: () => startSessionDraft(null) }]),
    {
      id: 'session' as const,
      label: session?.title ?? text.contextNewSession,
      current: !activeBranch,
    },
    ...(activeBranch
      ? [{ id: 'branch' as const, label: activeBranch.name, current: true }]
      : []),
  ];

  return (
    <main className={styles.workbench}>
      <AppTitleBar
        appName={text.appName}
        tagline={text.appTagline}
        navigationLabel={text.contextNavigation}
        breadcrumbs={contextBreadcrumbs}
        actions={
          <ThemeToggle
            labels={{
              toWhite: text.switchToWhiteTheme,
              toBlackGold: text.switchToBlackGoldTheme,
            }}
          />
        }
      />
      <section className={styles.leftPanel}>
        <ProjectSidebar
          projects={projects}
          recentDocuments={recentDocuments}
          localDocuments={localDocuments}
          documentsByProject={documentsByProject}
          sessionsByProject={sessionsByProject}
          localSessions={localSessions}
          sessionStatus={sessionStatus}
          expandedProjectIds={expandedProjectIds}
          selectedProjectId={project?.id}
          selectedDocumentId={document?.id}
          language={language}
          labels={text}
          onSelectDirectory={selectDirectory}
          onToggleProject={(item) => {
            void selectProject(item);
          }}
          onSelectDocument={(item) => {
            const matchingProject =
              item.projectId === null
                ? null
                : projects.find((candidate) => candidate.id === item.projectId) ?? null;
            setProject(matchingProject);
            void selectDocument(item as AnalysisDocument);
          }}
          onSelectLocal={() => {
            viewRequestSequence.current += 1;
            if (project !== null || (session !== null && session.projectId !== null)) {
              startSessionDraft(null);
            }
          }}
          onLanguageChange={(nextLanguage) => {
            void changeLanguage(nextLanguage);
          }}
          recentSessions={sessions}
          selectedSessionId={session?.id}
          onSelectSession={(nextSession) => {
            setProject(
              nextSession.projectId
                ? projects.find((candidate) => candidate.id === nextSession.projectId) ??
                    null
                : null,
            );
            void selectSession(nextSession);
          }}
          onCreateSession={(projectId) => {
            viewRequestSequence.current += 1;
            startSessionDraft(
              projectId
                ? projects.find((candidate) => candidate.id === projectId) ?? null
                : null,
            );
          }}
          sessionActionsDisabled={isRunning}
          onSessionStatusChange={(nextStatus) => void changeSessionStatus(nextStatus)}
          onRenameSession={(sessionId, title) => void renameSession(sessionId, title)}
          onArchiveSession={(sessionId) => void archiveSession(sessionId)}
          onRestoreSession={(sessionId) => void restoreSession(sessionId)}
          onDeleteSession={(sessionId) => void deleteSession(sessionId)}
        />
      </section>

      <section className={styles.centerPanel} ref={setReaderViewport}>
        {session ? (
          <div className={styles.branchSelector}>
            {branches.length > 1 ? (
              <label>
                <span>{text.branch}</span>
                <select
                  aria-label={text.branch}
                  disabled={isRunning || isForkingSession}
                  value={activeBranchId ?? ''}
                  onChange={(e) => void switchBranch(e.target.value)}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className={styles.branchForkButton}
              disabled={
                isRunning ||
                isForkingSession ||
                session.status === 'archived' ||
                !session.activeDocumentId
              }
              onClick={() => void forkSession(session.activeDocumentId!)}
            >
              <span className="material-symbols-rounded" aria-hidden="true">fork_right</span>
              {language === 'zh-CN' ? '\u521b\u5efa\u5206\u652f' : 'Create branch'}
            </button>
          </div>
        ) : null}
        {session ? (
          <ConversationTimeline
            turns={turns}
            activeTurnId={document?.id}
            onSelectTurn={(turn) => void handleVisibleDocument(turn.id)}
            onForkFromTurn={(documentId) => void forkSession(documentId)}
            forkDisabled={isRunning || isForkingSession || session.status === 'archived'}
            language={language}
          />
        ) : null}
        <div className={styles.conversation} role="log" aria-live="polite" aria-busy={isRunning}>
          {messages.length === 0 ? (
            <div className={styles.document}>
              <AnalysisMarkdownViewer
                content=""
                emptyLabel={text.emptyDocument}
                onTextSelect={setSelectedText}
              />
            </div>
          ) : (
            messages.map((message) =>
              message.role === 'user' ? (
                <div className={`${styles.messageRow} ${styles.userMessageRow}`} key={message.id}>
                  <article className={styles.userMessage} aria-label={text.you}>
                    {message.content}
                  </article>
                </div>
              ) : (
                <div className={`${styles.messageRow} ${styles.assistantMessageRow}`} key={message.id}>
                  <article
                    className={`${styles.assistantMessage} ${
                      message.state === 'error' ? styles.errorMessage : ''
                    }`}
                    aria-label={text.assistant}
                  >
                    {message.state === 'pending' ? (
                      <div className={styles.pendingMessage} role="status">
                        <span className={styles.pendingIndicator} aria-hidden="true" />
                        {text.analyzing}
                      </div>
                    ) : message.state === 'error' ? (
                      message.content
                    ) : (
                      <AnalysisMarkdownViewer
                        content={message.content}
                        documentId={message.documentId}
                        onTextSelect={(text, sourceRange) => {
                          void selectAnalysisText(message, text, sourceRange);
                        }}
                        annotations={
                          message.documentId
                            ? annotationsByDocument.get(message.documentId)
                            : undefined
                        }
                        activeAnnotationId={activeAnnotationId}
                        onAnnotationClick={handleAnnotationClick}
                        onVisible={handleVisibleDocument}
                        visibilityRoot={readerViewport}
                      />
                    )}
                  </article>
                  {message.state === 'complete' && message.documentId ? (
                    <ReplyActions
                      disabled={isRunning || session?.status === 'archived'}
                      labels={{ copy: '复制', checkout: '回退', fork: text.branch, export: '导出', exportMarkdown: text.exportMarkdown, exportJson: text.exportJson }}
                      onCopy={() => void navigator.clipboard?.writeText(message.content)}
                      onCheckout={() => { const turn = turns.find((item) => item.id === message.documentId); if (turn) void checkoutTurn(turn); }}
                      onFork={() => void forkSession(message.documentId!)}
                      onExport={(format) => void handleExport(message.documentId!, format)}
                    />
                  ) : null}
                </div>
              ),
            )
          )}
        </div>
      </section>

      <aside className={styles.rightPanel}>
        <h2>{text.toolTrace}</h2>
        <ToolTraceTimeline
          traces={traces}
          ariaLabel={text.toolTrace}
          emptyLabel={text.noToolCalls}
        />
        <h2>{text.comments}</h2>
        <AnnotationSidebar
          annotations={annotations}
          activeAnnotationId={activeAnnotationId}
          onActivate={setActiveAnnotationId}
          onViewSource={handleViewSource}
          onDelete={handleDeleteAnnotation}
          deleteLabel={text.deleteSession}
          confirmDeleteLabel={text.confirmDelete}
          cancelLabel={text.cancel}
          deleteWarningLabel={text.deleteAnnotationWarning}
          viewSourceLabel={text.viewSource}
          emptyLabel={text.noComments}
          statusLabels={{
            pending: text.pending,
            answered: text.answered,
            failed: text.failed,
          }}
        />
        {selectedText ? (
          <div ref={commentComposerRef} className={componentStyles.commentComposer}>
            <strong>{selectedText}</strong>
            <textarea
              aria-label={text.commentQuestion}
              value={comment}
              placeholder={text.commentPlaceholder}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void createAnnotation();
                }
              }}
            />
            <div className={componentStyles.commentFooter}>
              <span className={componentStyles.commentHint}>{text.commentHint}</span>
              <button type="button" onClick={createAnnotation} disabled={!comment.trim()}>
                {text.comment}
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <div className={styles.promptBar}>
        {session?.status === 'archived' ? (
          <div className={styles.archivedSessionNotice}>
            <span className="material-symbols-rounded" aria-hidden="true">
              archive
            </span>
            <span>{text.archivedSessionReadOnly}</span>
            <button type="button" onClick={() => void restoreSession(session.id)}>
              {text.restoreSession}
            </button>
          </div>
        ) : (
          <AnalysisPromptBox
            value={goal}
            disabled={isRunning}
            labels={{
              ariaLabel: text.analysisGoal,
              placeholder: text.promptPlaceholder,
              submit: text.run,
            }}
            onChange={setGoal}
            onSubmit={runAnalysis}
          />
        )}
        <div className={styles.status} role="status">
          {status}
        </div>
      </div>
    </main>
  );
}
