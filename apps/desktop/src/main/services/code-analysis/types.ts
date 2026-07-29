export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';
export type AnalysisAnnotationStatus = 'pending' | 'answered' | 'failed';
export type AnalysisMessageRole = 'user' | 'assistant';

export interface CodeProject {
  id: string;
  name: string;
  rootPath: string;
  rootPathHash: string;
  conversationCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisDocument {
  id: string;
  goal: string;
  contentMarkdown: string;
  status: AnalysisStatus;
  modelId?: string;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisToolTrace {
  id: string;
  analysisDocumentId: string;
  stepIndex: number;
  toolName: string;
  toolArgsJson: string;
  resultSummary: string;
  createdAt: string;
}

export interface AnalysisAnnotation {
  id: string;
  analysisDocumentId: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  anchorExactText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  question: string;
  status: AnalysisAnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisDiscussionMessage {
  id: string;
  annotationId: string;
  role: AnalysisMessageRole;
  content: string;
  modelId?: string;
  createdAt: string;
}
