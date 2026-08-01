/**
 * System IPC Handlers
 *
 * 注册 system 相关的 ipcMain.handle 处理器。
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type { IPCResult } from '@ai-reader/shared';
import { createTitleBarOverlay } from '../window-options';

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

  ipcMain.handle(
    IPC_CHANNELS.SYSTEM_SET_TITLE_BAR_OVERLAY,
    async (event, theme: unknown): Promise<IPCResult<void>> => {
      if (theme !== 'white' && theme !== 'black-gold') {
        return { success: false, error: 'Unsupported title bar theme' };
      }

      try {
        if (process.platform === 'win32') {
          BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(createTitleBarOverlay(theme));
        }
        return { success: true, data: undefined };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        log.error(`IPC system:setTitleBarOverlay failed: ${message}`);
        return { success: false, error: message };
      }
    },
  );
}
