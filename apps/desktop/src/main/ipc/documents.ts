/**
 * Document IPC Handlers
 *
 * 注册 document 相关的 ipcMain.handle 处理器。
 * 每个处理器捕获异常并返回统一 IPCResult 格式。
 */

import { ipcMain, dialog, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'fs/promises';
import { basename } from 'path';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  IPCResult,
  DocumentImportPayload,
  DocumentImportResult,
  DocumentSummary,
  ChapterData,
  OpenFileDialogResult,
  SaveFilePayload,
  SaveFileResult,
} from '@ai-reader/shared';
import type { DocumentImportService, DocumentDetail } from '../services/document-import';

const log = createLogger('ipc:documents');

/**
 * 注册 document 相关的 IPC 处理器。
 *
 * @param service DocumentImportService 实例
 */
export function registerDocumentHandlers(service: DocumentImportService): void {
  // ── document:import ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_IMPORT,
    async (_event, payload: DocumentImportPayload): Promise<IPCResult<DocumentImportResult>> => {
      try {
        log.info(`IPC document:import file=${payload.fileName}, workspace=${payload.workspaceId}`);
        const result = await service.importFromContent(
          payload.workspaceId,
          payload.fileName,
          payload.content,
        );
        return { success: true, data: result };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC document:import failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── document:list ───────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_LIST,
    async (_event, workspaceId: string): Promise<IPCResult<DocumentSummary[]>> => {
      try {
        log.debug(`IPC document:list workspace=${workspaceId}`);
        const list = await service.listByWorkspace(workspaceId);
        return { success: true, data: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC document:list failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── document:getById ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_GET_BY_ID,
    async (_event, docId: string): Promise<IPCResult<DocumentDetail | null>> => {
      try {
        log.debug(`IPC document:getById id=${docId}`);
        const doc = await service.getById(docId);
        return { success: true, data: doc };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC document:getById failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── document:getChapters ─────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_GET_CHAPTERS,
    async (_event, documentId: string): Promise<IPCResult<ChapterData[]>> => {
      try {
        log.debug(`IPC document:getChapters doc=${documentId}`);
        const doc = await service.getById(documentId);
        if (!doc) {
          return { success: true, data: [] };
        }
        return { success: true, data: doc.chapters as ChapterData[] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC document:getChapters failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── document:delete ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DOCUMENT_DELETE,
    async (_event, id: string): Promise<IPCResult<boolean>> => {
      try {
        log.info(`IPC document:delete id=${id}`);
        await service.delete(id);
        return { success: true, data: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC document:delete failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── dialog:openFile ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_FILE,
    async (event): Promise<IPCResult<OpenFileDialogResult>> => {
      try {
        log.info('IPC dialog:openFile');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return { success: false, error: 'No parent window found' };
        }

        const result = await dialog.showOpenDialog(win, {
          title: '选择文档',
          filters: [
            { name: '文档', extensions: ['md', 'markdown', 'txt'] },
            { name: '所有文件', extensions: ['*'] },
          ],
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled) {
          return {
            success: true,
            data: { canceled: true, filePaths: [] },
          };
        }

        // 读取文件内容
        const fileContents: Array<{ name: string; content: string }> = [];
        for (const filePath of result.filePaths) {
          const content = await readFile(filePath, 'utf-8');
          fileContents.push({
            name: basename(filePath),
            content,
          });
        }

        return {
          success: true,
          data: {
            canceled: false,
            filePaths: result.filePaths,
            fileContents,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC dialog:openFile failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── dialog:saveFile ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_SAVE_FILE,
    async (event, payload: SaveFilePayload): Promise<IPCResult<SaveFileResult>> => {
      try {
        log.info(`IPC dialog:saveFile file=${payload.defaultFileName}`);
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) {
          return { success: false, error: 'No parent window found' };
        }

        const result = await dialog.showSaveDialog(win, {
          title: '保存文件',
          defaultPath: payload.defaultFileName,
          filters: payload.filters,
        });

        if (result.canceled || !result.filePath) {
          return {
            success: true,
            data: { canceled: true, filePath: null },
          };
        }

        await writeFile(result.filePath, payload.content, 'utf8');
        return {
          success: true,
          data: { canceled: false, filePath: result.filePath },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC dialog:saveFile failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
