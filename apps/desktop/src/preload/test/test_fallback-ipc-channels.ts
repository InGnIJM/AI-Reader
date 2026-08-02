import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  api: undefined as
    | undefined
    | {
        codeAnalysis: {
          deleteAnnotation: (annotationId: string) => Promise<void>;
          forkSession: (payload: { sessionId: string; documentId: string }) => Promise<unknown>;
          forkActiveSession: (sessionId: string) => Promise<unknown>;
        };
      },
  invoke: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: typeof state.api) => {
      state.api = api;
    },
  },
  ipcRenderer: {
    invoke: state.invoke,
  },
}));

vi.mock('@ai-reader/shared', () => {
  throw new Error('shared package unavailable');
});

describe('preload fallback IPC channels', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    state.api = undefined;
    state.invoke.mockReset();
    state.invoke.mockResolvedValue({ success: true, data: undefined });
    vi.resetModules();
  });

  it('routes annotation deletion through the fallback delete channel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('../index');

    await state.api?.codeAnalysis.deleteAnnotation('ann-1');

    expect(state.invoke).toHaveBeenCalledWith('codeAnalysis:deleteAnnotation', {
      annotationId: 'ann-1',
    });
  });

  it('routes session forks through the fallback fork channel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('../index');

    await state.api?.codeAnalysis.forkSession({ sessionId: 'session-1', documentId: 'turn-2' });

    expect(state.invoke).toHaveBeenCalledWith('codeAnalysis:forkSession', {
      sessionId: 'session-1',
      documentId: 'turn-2',
    });
  });

  it('routes active session forks through the dedicated fallback channel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await import('../index');

    await state.api?.codeAnalysis.forkActiveSession('session-1');

    expect(state.invoke).toHaveBeenCalledWith('codeAnalysis:forkActiveSession', 'session-1');
  });
});
