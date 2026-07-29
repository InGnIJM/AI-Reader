import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@ai-reader/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSettingsHandlers } from './settings';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

describe('settings IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers language read and update channels', () => {
    registerSettingsHandlers({} as any);
    const channels = (ipcMain.handle as any).mock.calls.map((call: any[]) => call[0]);

    expect(channels).toContain(IPC_CHANNELS.SETTINGS_GET_LANGUAGE);
    expect(channels).toContain(IPC_CHANNELS.SETTINGS_SET_LANGUAGE);
  });
});
