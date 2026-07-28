/**
 * Workspace IPC Handlers
 *
 * 注册 workspace 相关的 ipcMain.handle 处理器。
 * 每个处理器捕获异常并返回统一 IPCResult 格式。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type {
  IPCResult,
  WorkspaceCreatePayload,
  WorkspaceData,
} from '@ai-reader/shared';
import type { WorkspaceService } from '../services/workspace';

const log = createLogger('ipc:workspace');

/**
 * 注册 workspace 相关的 IPC 处理器。
 *
 * @param service WorkspaceService 实例
 */
export function registerWorkspaceHandlers(service: WorkspaceService): void {
  // ── workspace:create ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_CREATE,
    async (_event, payload: WorkspaceCreatePayload): Promise<IPCResult<WorkspaceData>> => {
      try {
        log.info(`IPC workspace:create name=${payload.name}`);
        const ws = await service.create(payload.name, payload.description);
        return { success: true, data: ws };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC workspace:create failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── workspace:list ───────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_LIST,
    async (): Promise<IPCResult<WorkspaceData[]>> => {
      try {
        log.info('IPC workspace:list');
        const list = await service.list();
        return { success: true, data: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC workspace:list failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );

  // ── workspace:getById ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_GET_BY_ID,
    async (_event, id: string): Promise<IPCResult<WorkspaceData | null>> => {
      try {
        log.info(`IPC workspace:getById id=${id}`);
        const ws = await service.getById(id);
        return { success: true, data: ws };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC workspace:getById failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
