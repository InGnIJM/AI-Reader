/**
 * IPC Request / Response 类型定义
 *
 * 统一 IPC 调用的入参和返回值类型，供 main 和 preload 共享。
 */

// ── Generic Result Wrapper ──────────────────────────────────────────────────

/**
 * IPC 统一返回格式。
 *
 * 成功时 data 有值，error 为 undefined；
 * 失败时 error 有值，data 为 undefined。
 */
export type IPCResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: string };

// ── Workspace ───────────────────────────────────────────────────────────────

export interface WorkspaceCreatePayload {
  name: string;
  description?: string;
}

export interface WorkspaceData {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Document ────────────────────────────────────────────────────────────────

export interface DocumentImportPayload {
  workspaceId: string;
  fileName: string;
  content: string;
}

export interface DocumentSummary {
  id: string;
  workspaceId: string;
  fileName: string;
  fileType: string;
  fileHash: string;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterData {
  id: string;
  documentId: string;
  index: number;
  title: string;
  level: number;
  content: string;
}

export interface DocumentImportResult {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    fileHash: string;
    title: string;
    status: string;
  };
  chapters: {
    id: string;
    title: string;
    level: number;
  }[];
}

// ── Generation Job ──────────────────────────────────────────────────────────

export interface JobCreatePayload {
  documentId: string;
  totalSections: number;
}

export interface JobData {
  id: string;
  documentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalSections: number;
  completedSections: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobUpdateProgressPayload {
  id: string;
  completedSections: number;
}

export interface JobMarkFailedPayload {
  id: string;
  errorMessage: string;
}

// ── File Dialog ─────────────────────────────────────────────────────────────

export interface OpenFileDialogResult {
  canceled: boolean;
  filePaths: string[];
  fileContents?: Array<{ name: string; content: string }>;
}

// ── Annotation ──────────────────────────────────────────────────────────

/** 批注类型 */
export type AnnotationType = 'note' | 'question' | 'highlight';

/** 创建批注请求参数 */
export interface AnnotationCreatePayload {
  articleId: string;
  sectionId: string;
  selectedText: string;
  type: AnnotationType;
  content?: string;
}

/** 批注数据 */
export interface AnnotationData {
  id: string;
  articleId: string;
  sectionId: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  anchorExactText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  type: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpenDirectoryDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export type CodeAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';
export type CodeAnalysisAnnotationStatus = 'pending' | 'answered' | 'failed';
export type CodeAnalysisMessageRole = 'user' | 'assistant';

export interface CodeAnalysisProjectData {
  id: string;
  name: string;
  rootPath?: string;
  rootPathHash: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CodeAnalysisRunPayload {
  projectId: string;
  goal: string;
}

export interface CodeAnalysisDocumentData {
  id: string;
  projectId: string;
  goal: string;
  contentMarkdown: string;
  status: CodeAnalysisStatus;
  modelId?: string;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodeAnalysisToolTraceData {
  id?: string;
  analysisDocumentId?: string;
  stepIndex?: number;
  toolName: string;
  toolArgsJson?: string;
  resultSummary: string;
  createdAt?: string;
}

export interface CodeAnalysisAnnotationCreatePayload {
  analysisDocumentId: string;
  selectedText: string;
  question: string;
}

export interface CodeAnalysisAnnotationData {
  id: string;
  analysisDocumentId: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  anchorExactText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  question: string;
  status: CodeAnalysisAnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CodeAnalysisDiscussionMessageData {
  id: string;
  annotationId: string;
  role: CodeAnalysisMessageRole;
  content: string;
  modelId?: string;
  createdAt: string;
}
