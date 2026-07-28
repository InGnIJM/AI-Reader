/**
 * System IPC Handlers
 *
 * 注册 system 相关的 ipcMain.handle 处理器。
 */

import { app, ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type { IPCResult } from '@ai-reader/shared';

const log = createLogger('ipc:system');

/**
 * 注册 system 相关的 IPC 处理器。
 */
export function registerSystemHandlers(): void {
  // ── system:getVersion ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_GET_VERSION,
    async (): Promise<IPCResult<string>> => {
      try {
        log.debug('IPC system:getVersion');
        return { success: true, data: app.getVersion() };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC system:getVersion failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
