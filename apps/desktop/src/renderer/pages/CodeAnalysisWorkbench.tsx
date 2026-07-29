import { useCallback, useEffect, useRef, useState } from 'react';
import type {
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

type CodeProject = Pick<CodeAnalysisProjectData, 'id' | 'name'>;
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
  const [documents, setDocuments] = useState<AnalysisDocument[]>([]);
  const [project, setProject] = useState<CodeProject | null>(null);
  const [document, setDocument] = useState<AnalysisDocument | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [goal, setGoal] = useState('');
  const [traces, setTraces] = useState<ToolTraceItem[]>([]);
  const [annotations, setAnnotations] = useState<AnalysisAnnotationItem[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [comment, setComment] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');
  const messageSequence = useRef(0);
  const viewRequestSequence = useRef(0);
  const text = codeAnalysisText[language];

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.api.codeAnalysis.listProjects(),
      window.api.settings.getLanguage(),
    ])
      .then(([savedProjects, savedLanguage]) => {
        if (!active) return;
        setProjects(savedProjects);
        setLanguage(savedLanguage);
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
      setDocuments([]);
      const nextDocuments = await window.api.codeAnalysis.listDocuments(nextProject.id);
      if (requestId === viewRequestSequence.current) setDocuments(nextDocuments);
    },
    [clearDocumentState],
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
    const result = await window.api.dialog.openDirectory();
    if (result.canceled || !result.filePaths[0]) return;

    const created = await window.api.codeAnalysis.createProject(result.filePaths[0]);
    viewRequestSequence.current += 1;
    const nextProject = { id: created.id, name: created.name };
    setProjects((current) => [
      nextProject,
      ...current.filter((item) => item.id !== nextProject.id),
    ]);
    setProject(nextProject);
    setDocuments([]);
    clearDocumentState();
    setStatus(text.directorySelected);
  }, [clearDocumentState, text.directorySelected]);

  const runAnalysis = useCallback(async () => {
    if (!project || !goal.trim()) return;

    const submittedGoal = goal.trim();
    messageSequence.current += 1;
    const userMessageId = `user-${messageSequence.current}`;
    messageSequence.current += 1;
    const assistantMessageId = `assistant-${messageSequence.current}`;
    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    setMessages([
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
    setDocument(null);
    setTraces([]);
    setAnnotations([]);
    setIsRunning(true);
    setStatus(text.runningAnalysis);
    try {
      const nextDocument = await window.api.codeAnalysis.run(project.id, submittedGoal);
      if (requestId !== viewRequestSequence.current) return;
      setDocument(nextDocument);
      setDocuments((current) => [
        nextDocument,
        ...current.filter((item) => item.id !== nextDocument.id),
      ]);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: nextDocument.contentMarkdown,
                state: 'complete',
                documentId: nextDocument.id,
              }
            : message,
        ),
      );
      const [nextTraces, nextAnnotations] = await Promise.all([
        window.api.codeAnalysis.listTraces(nextDocument.id),
        loadAnnotations(nextDocument.id),
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
  }, [goal, loadAnnotations, project, text.analysisCompleted, text.analysisFailed, text.runningAnalysis]);

  const selectAnalysisText = useCallback(async (message: ConversationMessage, text: string) => {
    if (!message.documentId) return;

    const matchingDocument = documents.find((item) => item.id === message.documentId);
    if (!matchingDocument) return;
    viewRequestSequence.current += 1;
    const requestId = viewRequestSequence.current;
    setDocument(matchingDocument);
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
  }, [documents, language, loadAnnotations]);

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
          documents={documents}
          selectedProjectId={project?.id}
          selectedDocumentId={document?.id}
          language={language}
          labels={text}
          onSelectDirectory={selectDirectory}
          onSelectProject={(item) => {
            void selectProject(item);
          }}
          onSelectDocument={(item) => {
            const matchingDocument = documents.find((candidate) => candidate.id === item.id);
            if (matchingDocument) void selectDocument(matchingDocument);
          }}
          onLanguageChange={(nextLanguage) => {
            void changeLanguage(nextLanguage);
          }}
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
          disabled={!project || isRunning}
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
