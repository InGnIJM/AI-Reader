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
    DIALOG_SAVE_FILE: 'dialog:saveFile',
    CODE_ANALYSIS_CREATE_PROJECT: 'codeAnalysis:createProject',
    CODE_ANALYSIS_LIST_PROJECTS: 'codeAnalysis:listProjects',
    CODE_ANALYSIS_RUN: 'codeAnalysis:run',
    CODE_ANALYSIS_GET_DOCUMENT: 'codeAnalysis:getDocument',
    CODE_ANALYSIS_LIST_DOCUMENTS: 'codeAnalysis:listDocuments',
    CODE_ANALYSIS_LIST_RECENT_DOCUMENTS: 'codeAnalysis:listRecentDocuments',
    CODE_ANALYSIS_LIST_TRACES: 'codeAnalysis:listTraces',
    CODE_ANALYSIS_CREATE_ANNOTATION: 'codeAnalysis:createAnnotation',
    CODE_ANALYSIS_LIST_ANNOTATIONS: 'codeAnalysis:listAnnotations',
    CODE_ANALYSIS_LIST_ANNOTATION_MESSAGES: 'codeAnalysis:listAnnotationMessages',
    CODE_ANALYSIS_REPLY_TO_ANNOTATION: 'codeAnalysis:replyToAnnotation',
    CODE_ANALYSIS_EXPORT_DOCUMENT: 'codeAnalysis:exportDocument',
    CODE_ANALYSIS_IMPORT_DOCUMENT: 'codeAnalysis:importDocument',
    CODE_ANALYSIS_LIST_SESSIONS: 'codeAnalysis:listSessions',
    CODE_ANALYSIS_LIST_RECENT_SESSIONS: 'codeAnalysis:listRecentSessions',
    CODE_ANALYSIS_GET_SESSION: 'codeAnalysis:getSession',
    CODE_ANALYSIS_RENAME_SESSION: 'codeAnalysis:renameSession',
    CODE_ANALYSIS_ARCHIVE_SESSION: 'codeAnalysis:archiveSession',
    CODE_ANALYSIS_RESTORE_SESSION: 'codeAnalysis:restoreSession',
    CODE_ANALYSIS_DELETE_SESSION: 'codeAnalysis:deleteSession',
    CODE_ANALYSIS_RUN_TURN: 'codeAnalysis:runTurn',
    CODE_ANALYSIS_CHECKOUT_TURN: 'codeAnalysis:checkoutTurn',
    CODE_ANALYSIS_LIST_BRANCHES: 'codeAnalysis:listBranches',
    CODE_ANALYSIS_SWITCH_BRANCH: 'codeAnalysis:switchBranch',
    CODE_ANALYSIS_RENAME_BRANCH: 'codeAnalysis:renameBranch',
  };
}

import type {
  AnalysisBranch,
  AnalysisExportArtifact,
  AnalysisExportFormat,
  AnalysisSession,
  AnalysisSessionDetail,
  AnalysisTurn,
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
  SaveFilePayload,
  SaveFileResult,
  AnnotationCreatePayload,
  AnnotationData,
  CodeAnalysisAnnotationCreatePayload,
  CodeAnalysisAnnotationData,
  CodeAnalysisCheckoutTurnPayload,
  CodeAnalysisDeleteSessionPayload,
  CodeAnalysisDiscussionMessageData,
  CodeAnalysisDocumentData,
  CodeAnalysisListSessionsPayload,
  CodeAnalysisProjectData,
  CodeAnalysisRenameBranchPayload,
  CodeAnalysisRenameSessionPayload,
  CodeAnalysisRunPayload,
  CodeAnalysisRunTurnPayload,
  CodeAnalysisRunTurnResult,
  CodeAnalysisSwitchBranchPayload,
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
    saveFile: (payload: SaveFilePayload) =>
      invoke<SaveFileResult>(IPC_CHANNELS.DIALOG_SAVE_FILE, payload),
  },

  codeAnalysis: {
    createProject: (rootPath: string) =>
      invoke<CodeAnalysisProjectData>(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT, rootPath),
    listProjects: () =>
      invoke<CodeAnalysisProjectData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_PROJECTS),
    run: (projectId: string | null, goal: string) =>
      invoke<CodeAnalysisDocumentData>(
        IPC_CHANNELS.CODE_ANALYSIS_RUN,
        { projectId, goal } satisfies CodeAnalysisRunPayload,
      ),
    getDocument: (id: string) =>
      invoke<CodeAnalysisDocumentData | null>(IPC_CHANNELS.CODE_ANALYSIS_GET_DOCUMENT, id),
    listDocuments: (projectId: string | null) =>
      invoke<CodeAnalysisDocumentData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_DOCUMENTS, projectId),
    listRecentDocuments: () =>
      invoke<CodeAnalysisDocumentData[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_RECENT_DOCUMENTS),
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
    deleteAnnotation: (annotationId: string) =>
      invoke<void>(IPC_CHANNELS.CODE_ANALYSIS_DELETE_ANNOTATION, { annotationId }),
    exportDocument: (documentId: string, format: AnalysisExportFormat) =>
      invoke<AnalysisExportArtifact>(
        IPC_CHANNELS.CODE_ANALYSIS_EXPORT_DOCUMENT,
        documentId,
        format,
      ),
    importDocument: (payload: unknown) =>
      invoke<CodeAnalysisDocumentData>(IPC_CHANNELS.CODE_ANALYSIS_IMPORT_DOCUMENT, payload),

    // ── Session management ──────────────────────────────────────────────────
    listSessions: (payload: CodeAnalysisListSessionsPayload) =>
      invoke<AnalysisSession[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_SESSIONS, payload),
    listRecentSessions: (limit?: number) =>
      invoke<AnalysisSession[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_RECENT_SESSIONS, { limit }),
    getSession: (sessionId: string) =>
      invoke<AnalysisSessionDetail | null>(IPC_CHANNELS.CODE_ANALYSIS_GET_SESSION, sessionId),
    renameSession: (payload: CodeAnalysisRenameSessionPayload) =>
      invoke<AnalysisSession>(IPC_CHANNELS.CODE_ANALYSIS_RENAME_SESSION, payload),
    archiveSession: (sessionId: string) =>
      invoke<AnalysisSession>(IPC_CHANNELS.CODE_ANALYSIS_ARCHIVE_SESSION, sessionId),
    restoreSession: (sessionId: string) =>
      invoke<AnalysisSession>(IPC_CHANNELS.CODE_ANALYSIS_RESTORE_SESSION, sessionId),
    deleteSession: (payload: CodeAnalysisDeleteSessionPayload) =>
      invoke<{ cleanupPending: boolean }>(IPC_CHANNELS.CODE_ANALYSIS_DELETE_SESSION, payload),

    // ── Turn and branch management ──────────────────────────────────────────
    runTurn: (payload: CodeAnalysisRunTurnPayload) =>
      invoke<CodeAnalysisRunTurnResult>(IPC_CHANNELS.CODE_ANALYSIS_RUN_TURN, payload),
    checkoutTurn: (payload: CodeAnalysisCheckoutTurnPayload) =>
      invoke<void>(IPC_CHANNELS.CODE_ANALYSIS_CHECKOUT_TURN, payload),
    listBranches: (sessionId: string) =>
      invoke<AnalysisBranch[]>(IPC_CHANNELS.CODE_ANALYSIS_LIST_BRANCHES, sessionId),
    switchBranch: (payload: CodeAnalysisSwitchBranchPayload) =>
      invoke<void>(IPC_CHANNELS.CODE_ANALYSIS_SWITCH_BRANCH, payload),
    renameBranch: (payload: CodeAnalysisRenameBranchPayload) =>
      invoke<AnalysisBranch>(IPC_CHANNELS.CODE_ANALYSIS_RENAME_BRANCH, payload),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type ElectronAPI = typeof api;
