/**
 * Preload Script
 *
 * 通过 contextBridge 暴露类型安全的 API 给渲染进程。
 * 所有 IPC 通道名称从 @ai-reader/shared 的 IPC_CHANNELS 统一获取。
 */

import { contextBridge, ipcRenderer } from 'electron';

// 延迟加载 shared 模块，捕获可能的加载错误
let IPC_CHANNELS: any;
try {
  IPC_CHANNELS = require('@ai-reader/shared').IPC_CHANNELS;
  console.log('[preload] IPC_CHANNELS loaded:', IPC_CHANNELS);
} catch (err) {
  console.error('[preload] Failed to load @ai-reader/shared:', err);
  // 使用硬编码的通道名称作为后备（与 IPC_CHANNELS 定义一致）
  IPC_CHANNELS = {
    SYSTEM_GET_VERSION: 'system:getVersion',
    SETTINGS_GET_LANGUAGE: 'settings:getLanguage',
    SETTINGS_SET_LANGUAGE: 'settings:setLanguage',
    WORKSPACE_CREATE: 'workspace:create',
    WORKSPACE_LIST: 'workspace:list',
    WORKSPACE_GET_BY_ID: 'workspace:getById',
    DOCUMENT_IMPORT: 'document:import',
    DOCUMENT_LIST: 'document:list',
    DOCUMENT_GET_BY_ID: 'document:getById',
    DOCUMENT_GET_CHAPTERS: 'document:getChapters',
    DOCUMENT_DELETE: 'document:delete',
    JOB_CREATE: 'job:create',
    JOB_GET_BY_ID: 'job:getById',
    JOB_LIST_BY_DOCUMENT: 'job:listByDocument',
    JOB_START: 'job:start',
    JOB_UPDATE_PROGRESS: 'job:updateProgress',
    JOB_MARK_COMPLETED: 'job:markCompleted',
    JOB_MARK_FAILED: 'job:markFailed',
    ANNOTATION_CREATE: 'annotation:create',
    ANNOTATION_GET_BY_ID: 'annotation:getById',
    ANNOTATION_LIST_BY_SECTION: 'annotation:listBySection',
    ANNOTATION_LIST_BY_ARTICLE: 'annotation:listByArticle',
    ANNOTATION_DELETE: 'annotation:delete',
    DIALOG_OPEN_FILE: 'dialog:openFile',
    DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
    CODE_ANALYSIS_CREATE_PROJECT: 'codeAnalysis:createProject',
    CODE_ANALYSIS_LIST_PROJECTS: 'codeAnalysis:listProjects',
    CODE_ANALYSIS_RUN: 'codeAnalysis:run',
    CODE_ANALYSIS_GET_DOCUMENT: 'codeAnalysis:getDocument',
    CODE_ANALYSIS_LIST_DOCUMENTS: 'codeAnalysis:listDocuments',
    CODE_ANALYSIS_LIST_TRACES: 'codeAnalysis:listTraces',
    CODE_ANALYSIS_CREATE_ANNOTATION: 'codeAnalysis:createAnnotation',
    CODE_ANALYSIS_LIST_ANNOTATIONS: 'codeAnalysis:listAnnotations',
    CODE_ANALYSIS_LIST_ANNOTATION_MESSAGES: 'codeAnalysis:listAnnotationMessages',
    CODE_ANALYSIS_REPLY_TO_ANNOTATION: 'codeAnalysis:replyToAnnotation',
    CODE_ANALYSIS_EXPORT_MARKDOWN: 'codeAnalysis:exportMarkdown',
    CODE_ANALYSIS_EXPORT_JSON: 'codeAnalysis:exportJson',
    CODE_ANALYSIS_IMPORT_JSON: 'codeAnalysis:importJson',
  };
}

import type {
  IPCResult,
  WorkspaceCreatePayload,
  WorkspaceData,
  DocumentImportPayload,
  DocumentImportResult,
  DocumentSummary,
  ChapterData,
  JobCreatePayload,
  JobData,
  JobUpdateProgressPayload,
  JobMarkFailedPayload,
  OpenFileDialogResult,
  OpenDirectoryDialogResult,
  AnnotationCreatePayload,
  AnnotationData,
  CodeAnalysisAnnotationCreatePayload,
  CodeAnalysisAnnotationData,
  CodeAnalysisDiscussionMessageData,
  CodeAnalysisDocumentData,
  CodeAnalysisProjectData,
  CodeAnalysisRunPayload,
  CodeAnalysisToolTraceData,
  AppLanguage,
} from '@ai-reader/shared';

/**
 * 包装 ipcRenderer.invoke，解包 IPCResult。
 * 成功时返回 data，失败时抛出 Error。
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result: IPCResult<T> = await ipcRenderer.invoke(channel, ...args);
  if (result.success) {
    return result.data;
  }
  throw new Error(result.error);
}

const api = {
  // ── System ──────────────────────────────────────────────────────────────
  getAppVersion: () => invoke<string>(IPC_CHANNELS.SYSTEM_GET_VERSION),

  settings: {
    getLanguage: () => invoke<AppLanguage>(IPC_CHANNELS.SETTINGS_GET_LANGUAGE),
    setLanguage: (language: AppLanguage) =>
      invoke<AppLanguage>(IPC_CHANNELS.SETTINGS_SET_LANGUAGE, language),
  },

  // ── Workspace ───────────────────────────────────────────────────────────
  workspace: {
    create: (name: string, description?: string) =>
      invoke<WorkspaceData>(IPC_CHANNELS.WORKSPACE_CREATE, { name, description } satisfies WorkspaceCreatePayload),
    list: () => invoke<WorkspaceData[]>(IPC_CHANNELS.WORKSPACE_LIST),
    getById: (id: string) =>
      invoke<WorkspaceData | null>(IPC_CHANNELS.WORKSPACE_GET_BY_ID, id),
  },

  // ── Document ────────────────────────────────────────────────────────────
  documents: {
    import: (workspaceId: string, fileName: string, content: string) =>
      invoke<DocumentImportResult>(
        IPC_CHANNELS.DOCUMENT_IMPORT,
        { workspaceId, fileName, content } satisfies DocumentImportPayload,
      ),
    list: (workspaceId: string) =>
      invoke<DocumentSummary[]>(IPC_CHANNELS.DOCUMENT_LIST, workspaceId),
    getById: (docId: string) =>
      invoke<DocumentSummary | null>(IPC_CHANNELS.DOCUMENT_GET_BY_ID, docId),
    getChapters: (documentId: string) =>
      invoke<ChapterData[]>(IPC_CHANNELS.DOCUMENT_GET_CHAPTERS, documentId),
    delete: (id: string) =>
      invoke<boolean>(IPC_CHANNELS.DOCUMENT_DELETE, id),
  },

  // ── Generation Job ──────────────────────────────────────────────────────
  jobs: {
    create: (payload: JobCreatePayload) =>
      invoke<JobData>(IPC_CHANNELS.JOB_CREATE, payload),
    getById: (id: string) =>
      invoke<JobData | null>(IPC_CHANNELS.JOB_GET_BY_ID, id),
    listByDocument: (documentId: string) =>
      invoke<JobData[]>(IPC_CHANNELS.JOB_LIST_BY_DOCUMENT, documentId),
    start: (id: string) =>
      invoke<JobData | null>(IPC_CHANNELS.JOB_START, id),
    updateProgress: (payload: JobUpdateProgressPayload) =>
      invoke<JobData | null>(IPC_CHANNELS.JOB_UPDATE_PROGRESS, payload),
    markCompleted: (id: string) =>
      invoke<JobData | null>(IPC_CHANNELS.JOB_MARK_COMPLETED, id),
    markFailed: (payload: JobMarkFailedPayload) =>
      invoke<JobData | null>(IPC_CHANNELS.JOB_MARK_FAILED, payload),
  },

  // ── Annotation ────────────────────────────────────────────────────────────
  annotations: {
    create: (payload: AnnotationCreatePayload) =>
      invoke<AnnotationData>(IPC_CHANNELS.ANNOTATION_CREATE, payload),
    getById: (id: string) =>
      invoke<AnnotationData | null>(IPC_CHANNELS.ANNOTATION_GET_BY_ID, id),
    listBySection: (sectionId: string) =>
      invoke<AnnotationData[]>(IPC_CHANNELS.ANNOTATION_LIST_BY_SECTION, sectionId),
    listByArticle: (articleId: string) =>
      invoke<AnnotationData[]>(IPC_CHANNELS.ANNOTATION_LIST_BY_ARTICLE, articleId),
    delete: (id: string) =>
      invoke<void>(IPC_CHANNELS.ANNOTATION_DELETE, id),
  },

  // ── File Dialog ─────────────────────────────────────────────────────────
  dialog: {
    openFile: () =>
      invoke<OpenFileDialogResult>(IPC_CHANNELS.DIALOG_OPEN_FILE),
    openDirectory: () =>
      invoke<OpenDirectoryDialogResult>(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY),
  },

  codeAnalysis: {
    createProject: (rootPath: string) =>
      invoke<CodeAnalysisProjectData>(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT, rootPath),
    listProjects: () =>
      invoke<CodeAnalysisProjectData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_PROJECTS),
    run: (projectId: string, goal: string) =>
      invoke<CodeAnalysisDocumentData>(
        IPC_CHANNELS.CODE_ANALYSIS_RUN,
        { projectId, goal } satisfies CodeAnalysisRunPayload,
      ),
    getDocument: (id: string) =>
      invoke<CodeAnalysisDocumentData | null>(IPC_CHANNELS.CODE_ANALYSIS_GET_DOCUMENT, id),
    listDocuments: (projectId: string) =>
      invoke<CodeAnalysisDocumentData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_DOCUMENTS, projectId),
    listTraces: (documentId: string) =>
      invoke<CodeAnalysisToolTraceData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_TRACES, documentId),
    createAnnotation: (payload: CodeAnalysisAnnotationCreatePayload) =>
      invoke<CodeAnalysisAnnotationData>(IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION, payload),
    listAnnotations: (documentId: string) =>
      invoke<CodeAnalysisAnnotationData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATIONS, documentId),
    listAnnotationMessages: (annotationId: string) =>
      invoke<CodeAnalysisDiscussionMessageData[]>(
        IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATION_MESSAGES,
        annotationId,
      ),
    replyToAnnotation: (annotationId: string) =>
      invoke<CodeAnalysisDiscussionMessageData[]>(
        IPC_CHANNELS.CODE_ANALYSIS_REPLY_TO_ANNOTATION,
        annotationId,
      ),
    exportMarkdown: (documentId: string) =>
      invoke<string>(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_MARKDOWN, documentId),
    exportJson: (documentId: string) =>
      invoke<unknown>(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON, documentId),
    importJson: (payload: unknown) =>
      invoke<CodeAnalysisDocumentData>(IPC_CHANNELS.CODE_ANALYSIS_IMPORT_JSON, payload),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
