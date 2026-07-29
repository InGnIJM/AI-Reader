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
vi.mock('@ai-reader/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ai-reader/shared')>();
  return {
    ...original,
    createLogger: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

describe('code analysis IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers core code analysis channels', () => {
    registerCodeAnalysisHandlers({} as any);
    const channels = (ipcMain.handle as any).mock.calls.map((call: any[]) => call[0]);

    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_LIST_PROJECTS);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_RUN);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_LIST_DOCUMENTS);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATION_MESSAGES);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON);
  });

  it('returns an IPC failure when annotation reply generation fails', async () => {
    const deps = {
      analysisReplyEngine: {
        async *generateReply() {
          yield { type: 'error', error: 'Provider unavailable' };
        },
      },
      analysisAnnotationService: {
        listMessages: vi.fn(async () => []),
      },
    };
    registerCodeAnalysisHandlers(deps as any);
    const replyCall = (ipcMain.handle as any).mock.calls.find(
      (call: any[]) => call[0] === IPC_CHANNELS.CODE_ANALYSIS_REPLY_TO_ANNOTATION,
    );

    const result = await replyCall[1]({}, 'annotation-1');

    expect(result).toEqual({ success: false, error: 'Provider unavailable' });
    expect(deps.analysisAnnotationService.listMessages).not.toHaveBeenCalled();
  });
});
