import { ipcMain } from 'electron';
import { IPC_CHANNELS, createLogger } from '@ai-reader/shared';
import type { AppLanguage, IPCResult } from '@ai-reader/shared';

import type { SettingsService } from '../services/settings-service';

const log = createLogger('ipc:settings');

export function registerSettingsHandlers(settingsService: SettingsService): void {
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET_LANGUAGE,
    async (): Promise<IPCResult<AppLanguage>> =>
      handle('settings:getLanguage', () => settingsService.getLanguage()),
  );
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_LANGUAGE,
    async (_event, language: AppLanguage): Promise<IPCResult<AppLanguage>> =>
      handle('settings:setLanguage', () => settingsService.setLanguage(language)),
  );
}

async function handle<T>(label: string, fn: () => T): Promise<IPCResult<T>> {
  try {
    return { success: true, data: fn() };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error(`IPC ${label} failed: ${message}`);
    return { success: false, error: message };
  }
}
