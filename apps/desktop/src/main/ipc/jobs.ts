/**
 * Generation Job IPC Handlers
 *
 * 注册 generation job 相关的 ipcMain.handle 处理器。
 * 每个处理器捕获异常并返回统一 IPCResult 格式。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  IPCResult,
  JobCreatePayload,
  JobData,
  JobUpdateProgressPayload,
  JobMarkFailedPayload,
} from '@ai-reader/shared';
import type { GenerationJobService } from '../services/generation-job';

const log = createLogger('ipc:jobs');

/**
 * 注册 generation job 相关的 IPC 处理器。
 *
 * @param service GenerationJobService 实例
 */
export function registerJobHandlers(service: GenerationJobService): void {
  // ── job:create ───────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_CREATE,
    async (_event, payload: JobCreatePayload): Promise<IPCResult<JobData>> => {
      try {
        log.info(`IPC job:create doc=${payload.documentId}, sections=${payload.totalSections}`);
        const job = await service.create(payload);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:create failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:getById ──────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_GET_BY_ID,
    async (_event, id: string): Promise<IPCResult<JobData | null>> => {
      try {
        log.debug(`IPC job:getById id=${id}`);
        const job = await service.getById(id);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:getById failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:listByDocument ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_LIST_BY_DOCUMENT,
    async (_event, documentId: string): Promise<IPCResult<JobData[]>> => {
      try {
        log.debug(`IPC job:listByDocument doc=${documentId}`);
        const list = await service.listByDocument(documentId);
        return { success: true, data: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:listByDocument failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:start ────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_START,
    async (_event, id: string): Promise<IPCResult<JobData | null>> => {
      try {
        log.info(`IPC job:start id=${id}`);
        const job = await service.start(id);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:start failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:updateProgress ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_UPDATE_PROGRESS,
    async (_event, payload: JobUpdateProgressPayload): Promise<IPCResult<JobData | null>> => {
      try {
        log.debug(`IPC job:updateProgress id=${payload.id}, completed=${payload.completedSections}`);
        const job = await service.updateProgress(payload.id, payload.completedSections);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:updateProgress failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:markCompleted ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_MARK_COMPLETED,
    async (_event, id: string): Promise<IPCResult<JobData | null>> => {
      try {
        log.info(`IPC job:markCompleted id=${id}`);
        const job = await service.markCompleted(id);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:markCompleted failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── job:markFailed ───────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.JOB_MARK_FAILED,
    async (_event, payload: JobMarkFailedPayload): Promise<IPCResult<JobData | null>> => {
      try {
        log.info(`IPC job:markFailed id=${payload.id}`);
        const job = await service.markFailed(payload.id, payload.errorMessage);
        return { success: true, data: job };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC job:markFailed failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
