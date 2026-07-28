import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@ai-reader/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCodeAnalysisHandlers } from './code-analysis';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
}));

describe('code analysis IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers core code analysis channels', () => {
    registerCodeAnalysisHandlers({} as any);
    const channels = (ipcMain.handle as any).mock.calls.map((call: any[]) => call[0]);

    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_RUN);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON);
  });
});
