import { BrowserWindow, dialog, ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  AnalysisBranch,
  AnalysisExportArtifact,
  AnalysisExportFormat,
  AnalysisSession,
  AnalysisSessionDetail,
  AnalysisTurn,
  CodeAnalysisAnnotationCreatePayload,
  CodeAnalysisAnnotationData,
  CodeAnalysisDeleteAnnotationPayload,
  CodeAnalysisCheckoutTurnPayload,
  CodeAnalysisDeleteSessionPayload,
  CodeAnalysisForkSessionPayload,
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
  IPCResult,
  OpenDirectoryDialogResult,
} from '@ai-reader/shared';
import type {
  AnalysisAnnotationService,
  AnalysisBranchService,
  AnalysisExportService,
  AnalysisReplyEngine,
  AnalysisSessionService,
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
  sessionService: AnalysisSessionService;
  branchService: AnalysisBranchService;
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
    IPC_CHANNELS.CODE_ANALYSIS_DELETE_ANNOTATION,
    async (_event, payload: CodeAnalysisDeleteAnnotationPayload): Promise<IPCResult<void>> =>
      handle('codeAnalysis:deleteAnnotation', () =>
        deps.analysisAnnotationService.delete(payload.annotationId),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_EXPORT_DOCUMENT,
    async (_event, documentId: string, format: AnalysisExportFormat): Promise<IPCResult<AnalysisExportArtifact>> =>
      handle('codeAnalysis:exportDocument', () =>
        deps.analysisExportService.exportDocument(documentId, format),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_IMPORT_DOCUMENT,
    async (_event, payload: unknown): Promise<IPCResult<CodeAnalysisDocumentData>> =>
      handle('codeAnalysis:importDocument', () => deps.analysisExportService.importDocument(payload)),
  );

  // ── Session handlers ────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_SESSIONS,
    async (_event, payload: CodeAnalysisListSessionsPayload): Promise<IPCResult<AnalysisSession[]>> =>
      handle('codeAnalysis:listSessions', () =>
        deps.sessionService.listByProject(payload.projectId, payload.status),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_RECENT_SESSIONS,
    async (_event, payload?: { limit?: number }): Promise<IPCResult<AnalysisSession[]>> =>
      handle('codeAnalysis:listRecentSessions', () =>
        deps.sessionService.listRecent({ status: 'active', limit: payload?.limit }),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_GET_SESSION,
    async (_event, sessionId: string): Promise<IPCResult<AnalysisSessionDetail | null>> =>
      handle('codeAnalysis:getSession', () => deps.sessionService.getDetail(sessionId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_RENAME_SESSION,
    async (_event, payload: CodeAnalysisRenameSessionPayload): Promise<IPCResult<AnalysisSession>> =>
      handle('codeAnalysis:renameSession', () =>
        deps.sessionService.rename(payload.sessionId, payload.title),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_ARCHIVE_SESSION,
    async (_event, sessionId: string): Promise<IPCResult<AnalysisSession>> =>
      handle('codeAnalysis:archiveSession', () => deps.sessionService.archive(sessionId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_RESTORE_SESSION,
    async (_event, sessionId: string): Promise<IPCResult<AnalysisSession>> =>
      handle('codeAnalysis:restoreSession', () => deps.sessionService.restore(sessionId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_DELETE_SESSION,
    async (_event, payload: CodeAnalysisDeleteSessionPayload): Promise<IPCResult<{ cleanupPending: boolean }>> =>
      handle('codeAnalysis:deleteSession', () =>
        deps.sessionService.deletePermanently(payload.sessionId, payload.confirmed),
      ),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_FORK_SESSION,
    async (_event, payload: CodeAnalysisForkSessionPayload): Promise<IPCResult<AnalysisSession>> =>
      handle('codeAnalysis:forkSession', () =>
        deps.sessionService.forkAsIndependentSession(payload),
      ),
  );

  // ── Turn and branch handlers ────────────────────────────────────────────────

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_RUN_TURN,
    async (_event, payload: CodeAnalysisRunTurnPayload): Promise<IPCResult<CodeAnalysisRunTurnResult>> =>
      handle('codeAnalysis:runTurn', () => deps.codeAnalysisService.runTurn(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_CHECKOUT_TURN,
    async (_event, payload: CodeAnalysisCheckoutTurnPayload): Promise<IPCResult<void>> =>
      handle('codeAnalysis:checkoutTurn', () => deps.branchService.checkout(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_LIST_BRANCHES,
    async (_event, sessionId: string): Promise<IPCResult<AnalysisBranch[]>> =>
      handle('codeAnalysis:listBranches', () => deps.branchService.list(sessionId)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_SWITCH_BRANCH,
    async (_event, payload: CodeAnalysisSwitchBranchPayload): Promise<IPCResult<void>> =>
      handle('codeAnalysis:switchBranch', () => deps.branchService.switchBranch(payload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.CODE_ANALYSIS_RENAME_BRANCH,
    async (_event, payload: CodeAnalysisRenameBranchPayload): Promise<IPCResult<AnalysisBranch>> =>
      handle('codeAnalysis:renameBranch', () =>
        deps.branchService.rename(payload.sessionId, payload.branchId, payload.name),
      ),
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
