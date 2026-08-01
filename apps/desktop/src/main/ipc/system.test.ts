import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerSystemHandlers } from './system';
import { IPC_CHANNELS } from '@ai-reader/shared';

// Mock Electron
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const setTitleBarOverlay = vi.fn();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  app: {
    getVersion: () => '1.0.0-test',
  },
  BrowserWindow: {
    fromWebContents: () => ({ setTitleBarOverlay }),
  },
}));

describe('System IPC Handlers', () => {
  beforeEach(() => {
    handlers.clear();
    setTitleBarOverlay.mockReset();
    registerSystemHandlers();
  });

  it('should register system:getVersion handler', () => {
    expect(handlers.has(IPC_CHANNELS.SYSTEM_GET_VERSION)).toBe(true);
  });

  it('should return app version as IPCResult', async () => {
    const handler = handlers.get(IPC_CHANNELS.SYSTEM_GET_VERSION)!;
    const result = await handler({});

    expect(result).toEqual({
      success: true,
      data: '1.0.0-test',
    });
  });

  it('updates the native title-bar overlay for the requested theme', async () => {
    const handler = handlers.get(IPC_CHANNELS.SYSTEM_SET_TITLE_BAR_OVERLAY)!;

    await handler({}, 'white');

    expect(setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#F4F2EE',
      symbolColor: '#1E252C',
      height: 48,
    });
  });
});
