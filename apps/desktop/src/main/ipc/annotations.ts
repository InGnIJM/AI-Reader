/**
 * Annotation IPC Handlers
 *
 * 注册 annotation 相关的 ipcMain.handle 处理器。
 * 每个处理器捕获异常并返回统一 IPCResult 格式。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  IPCResult,
  AnnotationCreatePayload,
  AnnotationData,
} from '@ai-reader/shared';
import type { AnnotationService } from '../services/annotation';

const log = createLogger('ipc:annotations');

/**
 * 注册 annotation 相关的 IPC 处理器。
 *
 * @param service AnnotationService 实例
 */
export function registerAnnotationHandlers(service: AnnotationService): void {
  // ── annotation:create ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ANNOTATION_CREATE,
    async (_event, payload: AnnotationCreatePayload): Promise<IPCResult<AnnotationData>> => {
      try {
        log.info(`IPC annotation:create section=${payload.sectionId}, type=${payload.type}`);
        const annotation = await service.create(payload);
        return { success: true, data: annotation };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC annotation:create failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── annotation:getById ──────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ANNOTATION_GET_BY_ID,
    async (_event, id: string): Promise<IPCResult<AnnotationData | null>> => {
      try {
        log.debug(`IPC annotation:getById id=${id}`);
        const annotation = await service.getById(id);
        return { success: true, data: annotation };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC annotation:getById failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── annotation:listBySection ────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ANNOTATION_LIST_BY_SECTION,
    async (_event, sectionId: string): Promise<IPCResult<AnnotationData[]>> => {
      try {
        log.debug(`IPC annotation:listBySection section=${sectionId}`);
        const list = await service.listBySection(sectionId);
        return { success: true, data: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC annotation:listBySection failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── annotation:listByArticle ────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ANNOTATION_LIST_BY_ARTICLE,
    async (_event, articleId: string): Promise<IPCResult<AnnotationData[]>> => {
      try {
        log.debug(`IPC annotation:listByArticle article=${articleId}`);
        const list = await service.listByArticle(articleId);
        return { success: true, data: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC annotation:listByArticle failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── annotation:delete ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.ANNOTATION_DELETE,
    async (_event, id: string): Promise<IPCResult<void>> => {
      try {
        log.info(`IPC annotation:delete id=${id}`);
        await service.delete(id);
        return { success: true, data: undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC annotation:delete failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
