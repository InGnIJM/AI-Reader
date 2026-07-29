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
export type AppLanguage = 'zh-CN' | 'en-US';
export type AnalysisSessionStatus = 'active' | 'archived';

export interface AnalysisSession {
  id: string;
  projectId: string | null;
  title: string;
  status: AnalysisSessionStatus;
  activeBranchId: string | null;
  activeDocumentId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisBranch {
  id: string;
  sessionId: string;
  name: string;
  parentBranchId: string | null;
  forkedFromDocumentId: string | null;
  headDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisTurn {
  id: string;
  sessionId: string;
  branchId: string;
  parentDocumentId: string | null;
  goal: string;
  contentMarkdown: string;
  status: CodeAnalysisStatus;
  modelId?: string;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisSessionDetail {
  session: AnalysisSession;
  branches: AnalysisBranch[];
  turns: AnalysisTurn[];
}

export interface CodeAnalysisListSessionsPayload {
  projectId: string | null;
  status: AnalysisSessionStatus;
  limit?: number;
}

export interface CodeAnalysisListRecentSessionsPayload {
  limit?: number;
}

export interface CodeAnalysisRenameSessionPayload {
  sessionId: string;
  title: string;
}

export interface CodeAnalysisDeleteSessionPayload {
  sessionId: string;
  confirmed: true;
}

export interface CodeAnalysisRunTurnPayload {
  sessionId?: string;
  projectId?: string | null;
  parentDocumentId?: string;
  goal: string;
  forceFork?: boolean;
}

export interface CodeAnalysisRunTurnResult {
  session: AnalysisSession;
  branch: AnalysisBranch;
  turn: AnalysisTurn;
}

export interface CodeAnalysisCheckoutTurnPayload {
  sessionId: string;
  branchId: string;
  documentId: string;
}

export interface CodeAnalysisSwitchBranchPayload {
  sessionId: string;
  branchId: string;
}

export interface CodeAnalysisRenameBranchPayload extends CodeAnalysisSwitchBranchPayload {
  name: string;
}

export interface CodeAnalysisProjectData {
  id: string;
  name: string;
  rootPath?: string;
  rootPathHash: string;
  conversationCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CodeAnalysisRunPayload {
  projectId: string | null;
  goal: string;
}

export interface CodeAnalysisDocumentData {
  id: string;
  projectId: string | null;
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

interface CodeAnalysisAnnotationCreateBasePayload {
  analysisDocumentId: string;
  selectedText: string;
  question: string;
}

interface CodeAnalysisLegacyAnnotationCreatePayload
  extends CodeAnalysisAnnotationCreateBasePayload {
  sourceStartOffset?: never;
  sourceEndOffset?: never;
}

export interface CodeAnalysisSourceAnnotationCreatePayload
  extends CodeAnalysisAnnotationCreateBasePayload {
  sourceStartOffset: number;
  sourceEndOffset: number;
}

export type CodeAnalysisAnnotationCreatePayload =
  | CodeAnalysisLegacyAnnotationCreatePayload
  | CodeAnalysisSourceAnnotationCreatePayload;

export interface CodeAnalysisAnnotationData {
  id: string;
  analysisDocumentId: string;
  selectedText: string;
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
