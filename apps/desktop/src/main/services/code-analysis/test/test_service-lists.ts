import type { LLMProvider } from '@ai-reader/core';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../../../db/client';
import { CodeAnalysisService } from '../service';

describe('CodeAnalysisService list APIs', () => {
  it('lists projects and project documents in most-recently-updated order', async () => {
    const projects = [
      {
        id: 'project-new',
        name: 'New project',
        rootPath: 'E:/new',
        rootPathHash: 'new-hash',
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ];
    const documents = [
      {
        id: 'doc-new',
        projectId: 'project-new',
        goal: 'Explain pnpm',
        contentMarkdown: '# pnpm',
        status: 'completed',
        modelId: 'mock-model',
        toolCallCount: 2,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ];
    const all = vi
      .fn()
      .mockReturnValueOnce(projects)
      .mockReturnValueOnce(documents);
    const prepare = vi.fn(() => ({ all }));
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;
    const service = new CodeAnalysisService({ db, llm: {} as LLMProvider });

    await expect(service.listProjects()).resolves.toEqual(projects);
    await expect(service.listDocumentsByProject('project-new')).resolves.toEqual(documents);

    expect(prepare.mock.calls[0][0]).toContain('ORDER BY updated_at DESC');
    expect(prepare.mock.calls[1][0]).toContain('WHERE project_id = ?');
    expect(prepare.mock.calls[1][0]).toContain('ORDER BY updated_at DESC');
    expect(all).toHaveBeenLastCalledWith('project-new');
  });

  it('persists a failed document when analysis throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-reader-failed-analysis-'));
    const runs: Array<{ sql: string; args: unknown[] }> = [];
    let currentSql = '';
    const db = {
      db: {
        prepare: vi.fn((sql: string) => {
          currentSql = sql;
          return {
            get: vi.fn(() =>
              sql.includes('FROM code_projects')
                ? {
                    id: 'project-1',
                    name: 'Fixture',
                    rootPath: root,
                    rootPathHash: 'hash',
                    createdAt: '2026-07-29T00:00:00.000Z',
                    updatedAt: '2026-07-29T00:00:00.000Z',
                  }
                : undefined,
            ),
            run: vi.fn((...args: unknown[]) => {
              runs.push({ sql: currentSql, args });
              return {};
            }),
          };
        }),
      },
    } as unknown as DatabaseClient;
    const llm = {
      defaultModel: 'mock',
      chat: vi.fn(async () => {
        throw new Error('Provider unavailable');
      }),
    } as unknown as LLMProvider;

    try {
      const service = new CodeAnalysisService({ db, llm });
      await expect(
        service.runAnalysis({ projectId: 'project-1', goal: 'Explain startup' }),
      ).rejects.toThrow('Provider unavailable');

      const failureUpdate = runs.find((run) =>
        run.sql.includes("status = 'failed'"),
      );
      expect(failureUpdate).toBeDefined();
      expect(failureUpdate?.args[0]).toContain('Provider unavailable');

      runs.length = 0;
      const settingsFailureService = new CodeAnalysisService({
        db,
        llm,
        settings: {
          getLanguage() {
            throw new Error('Settings unavailable');
          },
        },
      });
      await expect(
        settingsFailureService.runAnalysis({
          projectId: 'project-1',
          goal: 'Explain settings',
        }),
      ).rejects.toThrow('Settings unavailable');
      expect(runs.some((run) => run.sql.includes("status = 'failed'"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
