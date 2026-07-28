import { useCallback, useState } from 'react';

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
import styles from './CodeAnalysisWorkbench.module.css';

interface CodeProject {
  id: string;
  name: string;
}

interface AnalysisDocument {
  id: string;
  contentMarkdown: string;
}

export default function CodeAnalysisWorkbench() {
  const [project, setProject] = useState<CodeProject | null>(null);
  const [document, setDocument] = useState<AnalysisDocument | null>(null);
  const [goal, setGoal] = useState('');
  const [traces, setTraces] = useState<ToolTraceItem[]>([]);
  const [annotations, setAnnotations] = useState<AnalysisAnnotationItem[]>([]);
  const [selectedText, setSelectedText] = useState('');
  const [comment, setComment] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');

  const selectDirectory = useCallback(async () => {
    const result = await window.api.dialog.openDirectory();
    if (result.canceled || !result.filePaths[0]) return;

    const created = await window.api.codeAnalysis.createProject(result.filePaths[0]);
    setProject({ id: created.id, name: created.name });
    setDocument(null);
    setTraces([]);
    setAnnotations([]);
    setStatus('Directory selected');
  }, []);

  const runAnalysis = useCallback(async () => {
    if (!project || !goal.trim()) return;

    setIsRunning(true);
    setStatus('Running analysis');
    try {
      const nextDocument = await window.api.codeAnalysis.run(project.id, goal.trim());
      setDocument({ id: nextDocument.id, contentMarkdown: nextDocument.contentMarkdown });
      setTraces(await window.api.codeAnalysis.listTraces(nextDocument.id));
      setAnnotations(await window.api.codeAnalysis.listAnnotations(nextDocument.id));
      setStatus('Analysis completed');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsRunning(false);
    }
  }, [goal, project]);

  const createAnnotation = useCallback(async () => {
    if (!document || !selectedText || !comment.trim()) return;

    const annotation = await window.api.codeAnalysis.createAnnotation({
      analysisDocumentId: document.id,
      selectedText,
      question: comment.trim(),
    });
    setAnnotations((current) => [...current, annotation]);
    setComment('');
    setSelectedText('');
    setStatus('Replying to comment');

    const messages = await window.api.codeAnalysis.replyToAnnotation(annotation.id);
    const refreshed = await window.api.codeAnalysis.listAnnotations(document.id);
    setAnnotations(
      refreshed.length > 0
        ? refreshed
        : [{ ...annotation, status: messages.length ? 'answered' : annotation.status }],
    );
    setStatus('Comment answered');
  }, [comment, document, selectedText]);

  return (
    <main className={styles.workbench}>
      <section className={styles.leftPanel}>
        <ProjectSidebar projectName={project?.name} onSelectDirectory={selectDirectory} />
        <ExportMenu
          disabled={!document}
          onExportMarkdown={() => document && window.api.codeAnalysis.exportMarkdown(document.id)}
          onExportJson={() => document && window.api.codeAnalysis.exportJson(document.id)}
        />
      </section>

      <section className={styles.centerPanel}>
        <div className={styles.document}>
          <AnalysisMarkdownViewer
            content={document?.contentMarkdown ?? ''}
            onTextSelect={(text) => {
              setSelectedText(text);
              setStatus('Text selected');
            }}
          />
        </div>
      </section>

      <aside className={styles.rightPanel}>
        <h2>Tool Trace</h2>
        <ToolTraceTimeline traces={traces} />
        <h2>Comments</h2>
        <AnnotationSidebar annotations={annotations} />
        {selectedText ? (
          <div className={componentStyles.commentComposer}>
            <strong>{selectedText}</strong>
            <textarea
              aria-label="Comment question"
              value={comment}
              placeholder="Ask about the selected text..."
              onChange={(event) => setComment(event.target.value)}
            />
            <button type="button" onClick={createAnnotation} disabled={!comment.trim()}>
              Comment
            </button>
          </div>
        ) : null}
      </aside>

      <div className={styles.promptBar}>
        <AnalysisPromptBox value={goal} disabled={!project || isRunning} onChange={setGoal} onSubmit={runAnalysis} />
        <div className={styles.status} role="status">
          {status}
        </div>
      </div>
    </main>
  );
}
