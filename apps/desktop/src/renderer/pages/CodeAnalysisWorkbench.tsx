import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisBranch,
  AnalysisSession,
  AnalysisTurn,
  CodeAnalysisDocumentData,
  CodeAnalysisProjectData,
} from '@ai-reader/shared';

import {
  AnalysisMarkdownViewer,
  AnalysisPromptBox,
  AnnotationSidebar,
  ExportMenu,
  ProjectSidebar,
  ToolTraceTimeline,
} from '../components/code-analysis';
import type { AnalysisAnnotationItem, ToolTraceItem } from '../components/code-analysis';
import componentStyles from '../components/code-analysis/CodeAnalysisComponents.module.css';
import { codeAnalysisText } from './code-analysis-i18n';
import type { AppLanguage } from './code-analysis-i18n';
import styles from './CodeAnalysisWorkbench.module.css';

type CodeProject = Pick<CodeAnalysisProjectData, 'id' | 'name' | 'conversationCount'>;
type AnalysisDocument = CodeAnalysisDocumentData;

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  state: 'pending' | 'complete' | 'error';
  documentId?: string;
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
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [goal, setGoal] = useState('');
  const [traces, setTraces] = useState<ToolTraceItem[]>([]);
  const [annotations, setAnnotations] = useState<AnalysisAnnotationItem[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | undefined>();
  const [selectedText, setSelectedText] = useState('');
  const [comment, setComment] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');
  const messageSequence = useRef(0);
  const viewRequestSequence = useRef(0);
  const text = codeAnalysisText[language];

  // Session state
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [branches, setBranches] = useState<AnalysisBranch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AnalysisTurn[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.api.codeAnalysis.listProjects(),
      window.api.codeAnalysis.listRecentDocuments(),
      window.api.codeAnalysis.listDocuments(null),
      window.api.settings.getLanguage(),
      window.api.codeAnalysis.listRecentSessions(20),
    ])
      .then(([savedProjects, savedRecentDocuments, savedLocalDocuments, savedLanguage, savedSessions]) => {
        if (!active) return;
        setProjects(savedProjects);
        setRecentDocuments(savedRecentDocuments);
        setLocalDocuments(savedLocalDocuments);
        setLanguage(savedLanguage);
        setSessions(savedSessions);
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

  // ── Session management ────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    try {
      const savedSessions = await window.api.codeAnalysis.listRecentSessions(20);
      setSessions(savedSessions);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to load sessions');
    }
  }, []);

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
      setSelectedText('');
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

        // Load annotations for the last turn
        if (detail.turns.length > 0) {
          const lastTurn = detail.turns[detail.turns.length - 1];
          const [nextTraces, nextAnnotations] = await Promise.all([
            window.api.codeAnalysis.listTraces(lastTurn.id),
            loadAnnotations(lastTurn.id),
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
      setSessions((current) =>
        current.map((s) => (s.id === sessionId ? updated : s)),
      );
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to rename session');
    }
  }, [session]);

  const archiveSession = useCallback(async (sessionId: string) => {
    try {
      const updated = await window.api.codeAnalysis.archiveSession(sessionId);
      setSessions((current) =>
        current.map((s) => (s.id === sessionId ? updated : s)),
      );
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to archive session');
    }
  }, [session]);

  const restoreSession = useCallback(async (sessionId: string) => {
    try {
      const updated = await window.api.codeAnalysis.restoreSession(sessionId);
      setSessions((current) =>
        current.map((s) => (s.id === sessionId ? updated : s)),
      );
      if (session?.id === sessionId) {
        setSession(updated);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to restore session');
    }
  }, [session]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await window.api.codeAnalysis.deleteSession({ sessionId, confirmed: true });
      setSessions((current) => current.filter((s) => s.id !== sessionId));
      if (session?.id === sessionId) {
        setSession(null);
        setBranches([]);
        setActiveBranchId(null);
        setTurns([]);
        setMessages([]);
        setTraces([]);
        setAnnotations([]);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to delete session');
    }
  }, [session]);

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

  const clearDocumentState = useCallback(() => {
    setDocument(null);
    setMessages([]);
    setTraces([]);
    setAnnotations([]);
    setSelectedText('');
    setComment('');
  }, []);

  const selectProject = useCallback(
    async (nextProject: CodeProject) => {
      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      setProject(nextProject);
      clearDocumentState();
      const isExpanded = expandedProjectIds.has(nextProject.id);
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        if (next.has(nextProject.id)) next.delete(nextProject.id);
        else next.add(nextProject.id);
        return next;
      });
      if (isExpanded) return;
      const nextDocuments = await window.api.codeAnalysis.listDocuments(nextProject.id);
      if (requestId === viewRequestSequence.current) {
        setDocumentsByProject((current) => ({
          ...current,
          [nextProject.id]: nextDocuments,
        }));
      }
    },
    [clearDocumentState, expandedProjectIds],
  );

  const selectDocument = useCallback(
    async (nextDocument: AnalysisDocument) => {
      viewRequestSequence.current += 1;
      const requestId = viewRequestSequence.current;
      setDocument(nextDocument);
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
    setProject(nextProject);
    clearDocumentState();
    setExpandedProjectIds((current) => new Set(current).add(nextProject.id));
    const nextDocuments = await window.api.codeAnalysis.listDocuments(nextProject.id);
    if (requestId !== viewRequestSequence.current) return;
    setDocumentsByProject((current) => ({
      ...current,
      [nextProject.id]: nextDocuments,
    }));
    setStatus(text.directorySelected);
  }, [clearDocumentState, text.directorySelected]);

  const runAnalysis = useCallback(async () => {
    if (!goal.trim()) return;

    const submittedGoal = goal.trim();
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

      // Update project conversation count
      if (result.session.projectId) {
        setProjects((current) =>
          current.map((item) =>
            item.id === result.session.projectId
              ? { ...item, conversationCount: (item.conversationCount ?? 0) + 1 }
              : item,
          ),
        );
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
    } finally {
      setIsRunning(false);
    }
  }, [goal, loadAnnotations, project, session, turns, text.analysisCompleted, text.analysisFailed, text.runningAnalysis]);

  const selectAnalysisText = useCallback(async (message: ConversationMessage, text: string) => {
    if (!message.documentId) return;

    if (!document || document.id !== message.documentId) return;
    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    setSelectedText(text);
    setStatus(codeAnalysisText[language].textSelected);
    const [nextTraces, nextAnnotations] = await Promise.all([
      window.api.codeAnalysis.listTraces(message.documentId),
      loadAnnotations(message.documentId),
    ]);
    if (requestId === viewRequestSequence.current) {
      setTraces(nextTraces);
      setAnnotations(nextAnnotations);
    }
  }, [document, language, loadAnnotations]);

  const createAnnotation = useCallback(async () => {
    if (!document || !selectedText || !comment.trim()) return;

    const requestId = viewRequestSequence.current;
    const annotation = await window.api.codeAnalysis.createAnnotation({
      analysisDocumentId: document.id,
      selectedText,
      question: comment.trim(),
    });
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

  return (
    <main className={styles.workbench}>
      <section className={styles.leftPanel}>
        <ProjectSidebar
          projects={projects}
          recentDocuments={recentDocuments}
          localDocuments={localDocuments}
          documentsByProject={documentsByProject}
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
            setProject(null);
            clearDocumentState();
          }}
          onLanguageChange={(nextLanguage) => {
            void changeLanguage(nextLanguage);
          }}
          // Session props - only enable session mode after sessions load
          recentSessions={sessions.length > 0 ? sessions : undefined}
          selectedSessionId={session?.id}
          onSelectSession={(s) => void selectSession(s)}
          onRenameSession={(sessionId, title) => void renameSession(sessionId, title)}
          onArchiveSession={(sessionId) => void archiveSession(sessionId)}
          onDeleteSession={(sessionId) => void deleteSession(sessionId)}
        />
        <ExportMenu
          disabled={!document}
          markdownLabel={text.exportMarkdown}
          jsonLabel={text.exportJson}
          onExportMarkdown={() => document && window.api.codeAnalysis.exportMarkdown(document.id)}
          onExportJson={() => document && window.api.codeAnalysis.exportJson(document.id)}
        />
      </section>

      <section className={styles.centerPanel}>
        {session && branches.length > 1 ? (
          <div className={styles.branchSelector}>
            <label>
              <span>{text.branch}</span>
              <select
                aria-label={text.branch}
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
          </div>
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
                        onTextSelect={(text) => {
                          void selectAnalysisText(message, text);
                        }}
                      />
                    )}
                  </article>
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
          emptyLabel={text.noComments}
          statusLabels={{
            pending: text.pending,
            answered: text.answered,
            failed: text.failed,
          }}
        />
        {selectedText ? (
          <div className={componentStyles.commentComposer}>
            <strong>{selectedText}</strong>
            <textarea
              aria-label={text.commentQuestion}
              value={comment}
              placeholder={text.commentPlaceholder}
              onChange={(event) => setComment(event.target.value)}
            />
            <button type="button" onClick={createAnnotation} disabled={!comment.trim()}>
              {text.comment}
            </button>
          </div>
        ) : null}
      </aside>

      <div className={styles.promptBar}>
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
        <div className={styles.status} role="status">
          {status}
        </div>
      </div>
    </main>
  );
}
