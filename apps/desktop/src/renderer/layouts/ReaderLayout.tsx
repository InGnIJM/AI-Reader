import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import styles from './ReaderLayout.module.css';

export interface ReaderLayoutProps {
  /** 左栏：目录大纲 */
  outline?: ReactNode;
  /** 中栏顶部工具栏 */
  toolbar?: ReactNode;
  /** 右栏：批注 / AI 面板 */
  annotation?: ReactNode;
  /** 中栏正文内容 */
  children?: ReactNode;
  /** 文档导入后的回调 */
  onDocumentImported?: (result: { documentId: string; chapters: Array<{ id: string; title: string }> }) => void;
}

export default function ReaderLayout({
  outline,
  toolbar,
  annotation,
  children,
  onDocumentImported,
}: ReaderLayoutProps) {
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [annotationCollapsed, setAnnotationCollapsed] = useState(false);
  const [importing, setImporting] = useState(false);

  const toggleOutline = useCallback(() => {
    setOutlineCollapsed((prev) => !prev);
  }, []);

  const toggleAnnotation = useCallback(() => {
    setAnnotationCollapsed((prev) => !prev);
  }, []);

  const handleImport = useCallback(async () => {

    if (importing) return;
    setImporting(true);

    try {
      // 1. 打开文件对话框
      const dialogResult = await window.api.dialog.openFile();

      if (dialogResult.canceled || !dialogResult.fileContents?.length) {
        return;
      }

      // 2. 确保有工作区（自动创建默认工作区）
      let workspaces = await window.api.workspace.list();
      let workspaceId: string;
      if (workspaces.length === 0) {
        const ws = await window.api.workspace.create('默认工作区');
        workspaceId = ws.id;
      } else {
        workspaceId = workspaces[0].id;
      }

      // 3. 导入每个文件
      for (const file of dialogResult.fileContents) {
        const result = await window.api.documents.import(workspaceId, file.name, file.content);
        onDocumentImported?.({
          documentId: result.document.id,
          chapters: result.chapters,
        });
      }
    } catch (err) {
      console.error('导入失败:', err);
    } finally {
      setImporting(false);
    }
  }, [importing, onDocumentImported]);

  return (
    <div className={styles.readerLayout} data-testid="reader-layout">
      {/* Left — Outline sidebar */}
      <aside
        className={`${styles.outlinePanel} ${outlineCollapsed ? styles.outlinePanelCollapsed : ''}`}
        aria-label="目录大纲"
        aria-hidden={outlineCollapsed}
      >
        <div className={styles.outlineHeader}>
          <span className={styles.outlineTitle}>目录</span>
          <button
            className={styles.iconButton}
            onClick={toggleOutline}
            aria-label="折叠目录"
            title="折叠目录"
          >
            <span className="material-symbols-rounded">chevron_left</span>
          </button>
        </div>
        <div className={styles.outlineContent}>
          {outline ?? (
            <div className={styles.emptyState}>
              <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
                menu_book
              </span>
              <span>打开文档后显示目录</span>
            </div>
          )}
        </div>
      </aside>

      {/* Center — Content area */}
      <main className={styles.contentArea}>
        <div className={styles.contentToolbar}>
          {outlineCollapsed && (
            <button
              className={styles.iconButton}
              onClick={toggleOutline}
              aria-label="展开目录"
              title="展开目录"
            >
              <span className="material-symbols-rounded">menu</span>
            </button>
          )}
          <button
            className={styles.iconButton}
            onClick={handleImport}
            disabled={importing}
            aria-label="导入文档"
            title="导入文档"
          >
            <span className="material-symbols-rounded">upload_file</span>
          </button>
          {toolbar}
          {annotationCollapsed && (
            <button
              className={styles.iconButton}
              onClick={toggleAnnotation}
              aria-label="展开批注面板"
              title="展开批注面板"
              style={{ marginLeft: 'auto' }}
            >
              <span className="material-symbols-rounded">chat_bubble_outline</span>
            </button>
          )}
        </div>
        <div className={styles.contentBody}>
          {children ?? (
            <div className={styles.emptyState}>
              <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
                description
              </span>
              <span>导入文档开始阅读</span>
            </div>
          )}
        </div>
      </main>

      {/* Right — Annotation panel */}
      <aside
        className={`${styles.annotationPanel} ${annotationCollapsed ? styles.annotationPanelCollapsed : ''}`}
        aria-label="批注与讨论"
        aria-hidden={annotationCollapsed}
      >
        <div className={styles.annotationHeader}>
          <button
            className={styles.iconButton}
            onClick={toggleAnnotation}
            aria-label="折叠批注面板"
            title="折叠批注面板"
          >
            <span className="material-symbols-rounded">chevron_right</span>
          </button>
          <span className={styles.annotationTitle}>批注与讨论</span>
        </div>
        <div className={styles.annotationContent}>
          {annotation ?? (
            <div className={styles.emptyState}>
              <span className={`material-symbols-rounded ${styles.emptyStateIcon}`}>
                edit_note
              </span>
              <span>选中文本创建批注</span>
            </div>
          )}
        </div>
        <div className={styles.annotationComposer} />
      </aside>
    </div>
  );
}
