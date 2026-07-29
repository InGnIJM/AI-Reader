import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  CodeAnalysisAnnotationCreatePayload,
  CodeAnalysisAnnotationData,
  CodeAnalysisDiscussionMessageData,
  CodeAnalysisDocumentData,
  CodeAnalysisProjectData,
  CodeAnalysisRunPayload,
  CodeAnalysisToolTraceData,
  IPCResult,
  OpenDirectoryDialogResult,
} from '@ai-reader/shared';
import type {
  AireaderCodeAnalysisExport,
  AnalysisAnnotationService,
  AnalysisExportService,
  AnalysisReplyEngine,
  CodeAnalysisService,
} from '../services/code-analysis';
import {
  hashProjectRootPath,
  normalizeProjectRootPath,
} from '../db/code-analysis-migration';

const log = createLogger('ipc:code-analysis');
const authorizedDirectoriesBySender = new Map<number, Set<string>>();

export interface CodeAnalysisHandlerDeps {
  codeAnalysisService: CodeAnalysisService;
  analysisAnnotationService: AnalysisAnnotationService;
  analysisReplyEngine: AnalysisReplyEngine;
  analysisExportService: AnalysisExportService;
}

export function registerCodeAnalysisHandlers(deps: CodeAnalysisHandlerDeps): void {
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_DIRECTORY,
    async (event): Promise<IPCResult<OpenDirectoryDialogResult>> =>
      handle('dialog:openDirectory', async () => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return { canceled: true, filePaths: [] };
        const result = await dialog.showOpenDialog(win, {
          title: 'Select code directory',
          properties: ['openDirectory'],
        });
        if (!result.canceled) {
          const senderId = event.sender.id;
          const authorizedDirectories =
            authorizedDirectoriesBySender.get(senderId) ?? new Set<string>();
          result.filePaths.forEach((filePath) =>
            authorizedDirectories.add(hashProjectRootPath(filePath)),
          );
          authorizedDirectoriesBySender.set(senderId, authorizedDirectories);
          event.sender.once?.('destroyed', () => {
            authorizedDirectoriesBySender.delete(senderId);
          });
        }
        return { canceled: result.canceled, filePaths: result.filePaths };
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT,
    async (event, rootPath: string): Promise<IPCResult<CodeAnalysisProjectData>> =>
      handle('codeAnalysis:createProject', () => {
        const normalizedRootPath = normalizeProjectRootPath(rootPath);
        const authorizedDirectories = authorizedDirectoriesBySender.get(event.sender.id);
        if (!authorizedDirectories?.delete(hashProjectRootPath(normalizedRootPath))) {
          throw new Error('Directory access was not authorized by the user');
        }
        if (authorizedDirectories.size === 0) {
          authorizedDirectoriesBySender.delete(event.sender.id);
        }
        return deps.codeAnalysisService.createProject(normalizedRootPath);
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_PROJECTS,
    async (): Promise<IPCResult<CodeAnalysisProjectData[]>> =>
      handle('codeAnalysis:listProjects', () => deps.codeAnalysisService.listProjects()),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_RUN,
    async (_event, payload: CodeAnalysisRunPayload): Promise<IPCResult<CodeAnalysisDocumentData>> =>
      handle('codeAnalysis:run', () => deps.codeAnalysisService.runAnalysis(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_DOCUMENTS,
    async (_event, projectId: string | null): Promise<IPCResult<CodeAnalysisDocumentData[]>> =>
      handle('codeAnalysis:listDocuments', () =>
        deps.codeAnalysisService.listDocumentsByProject(projectId),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_RECENT_DOCUMENTS,
    async (): Promise<IPCResult<CodeAnalysisDocumentData[]>> =>
      handle('codeAnalysis:listRecentDocuments', () =>
        deps.codeAnalysisService.listRecentDocuments(),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_GET_DOCUMENT,
    async (_event, documentId: string): Promise<IPCResult<CodeAnalysisDocumentData | null>> =>
      handle('codeAnalysis:getDocument', () => deps.codeAnalysisService.getDocument(documentId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_TRACES,
    async (_event, documentId: string): Promise<IPCResult<CodeAnalysisToolTraceData[]>> =>
      handle('codeAnalysis:listTraces', () => deps.codeAnalysisService.listToolTraces(documentId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION,
    async (_event, payload: CodeAnalysisAnnotationCreatePayload): Promise<IPCResult<CodeAnalysisAnnotationData>> =>
      handle('codeAnalysis:createAnnotation', () => deps.analysisAnnotationService.create(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATIONS,
    async (_event, documentId: string): Promise<IPCResult<CodeAnalysisAnnotationData[]>> =>
      handle('codeAnalysis:listAnnotations', () => deps.analysisAnnotationService.listByDocument(documentId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATION_MESSAGES,
    async (
      _event,
      annotationId: string,
    ): Promise<IPCResult<CodeAnalysisDiscussionMessageData[]>> =>
      handle('codeAnalysis:listAnnotationMessages', () =>
        deps.analysisAnnotationService.listMessages(annotationId),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_REPLY_TO_ANNOTATION,
    async (_event, annotationId: string): Promise<IPCResult<CodeAnalysisDiscussionMessageData[]>> =>
      handle('codeAnalysis:replyToAnnotation', async () => {
        for await (const event of deps.analysisReplyEngine.generateReply({ annotationId })) {
          if (event.type === 'error') throw new Error(event.error);
        }
        return deps.analysisAnnotationService.listMessages(annotationId);
      }),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_EXPORT_MARKDOWN,
    async (_event, documentId: string): Promise<IPCResult<string>> =>
      handle('codeAnalysis:exportMarkdown', () => deps.analysisExportService.exportMarkdown(documentId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON,
    async (_event, documentId: string): Promise<IPCResult<AireaderCodeAnalysisExport>> =>
      handle('codeAnalysis:exportJson', () => deps.analysisExportService.exportJson(documentId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_IMPORT_JSON,
    async (_event, payload: AireaderCodeAnalysisExport): Promise<IPCResult<CodeAnalysisDocumentData>> =>
      handle('codeAnalysis:importJson', () => deps.analysisExportService.importJson(payload)),
  );
}

async function handle<T>(label: string, fn: () => Promise<T> | T): Promise<IPCResult<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`IPC ${label} failed: ${message}`);
    return { success: false, error: message };
  }
}
