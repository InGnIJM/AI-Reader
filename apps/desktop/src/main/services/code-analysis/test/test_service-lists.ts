import type { LLMProvider } from '@ai-reader/core';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../../../db/client';
import { CodeAnalysisService } from '../service';

describe('CodeAnalysisService list APIs', () => {
  it('reuses a project when the selected directory resolves to the same normalized path', async () => {
    const existing = {
      id: 'project-existing',
      name: 'AI-Reader',
      rootPath: 'E:\\code\\AI-Reader',
      rootPathHash: 'normalized-hash',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    const insert = vi.fn();
    const get = vi.fn(() => existing);
    const prepare = vi.fn((sql: string) => ({
      get: sql.includes('root_path_hash = ?') ? get : vi.fn(),
      run: insert,
    }));
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;
    const service = new CodeAnalysisService({
      db,
      llm: {} as LLMProvider,
      projectPathHash: () => 'normalized-hash',
    });

    await expect(service.createProject('e:/code/AI-Reader/')).resolves.toEqual(existing);
    expect(get).toHaveBeenCalledWith('normalized-hash');
    expect(insert).not.toHaveBeenCalled();
  });

  it('creates a new normalized project and returns null for a missing project', async () => {
    const run = vi.fn();
    const prepare = vi.fn((sql: string) => ({
      get: vi.fn(() => undefined),
      run: sql.includes('INSERT INTO code_projects') ? run : vi.fn(),
    }));
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;
    const service = new CodeAnalysisService({ db, llm: {} as LLMProvider });

    const project = await service.createProject('E:/code/AI-Reader/');

    expect(project.name).toBe('AI-Reader');
    expect(project.rootPath).not.toMatch(/[\\/]$/);
    expect(project.rootPathHash).toHaveLength(64);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(service.getProject('missing')).resolves.toBeNull();
  });

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

    const calls = prepare.mock.calls as unknown as Array<[string]>;
    expect(calls[0][0]).toContain('ORDER BY p.updated_at DESC');
    expect(calls[1][0]).toContain('WHERE project_id = ?');
    expect(calls[1][0]).toContain('ORDER BY updated_at DESC');
    expect(all).toHaveBeenLastCalledWith('project-new');
  });

  it('lists recent conversations globally and supports the no-project folder', async () => {
    const recentDocuments = [
      {
        id: 'doc-local',
        projectId: null,
        goal: 'Draft a local document',
        contentMarkdown: '# Local',
        status: 'completed',
        toolCallCount: 0,
        createdAt: '2026-07-29T01:00:00.000Z',
        updatedAt: '2026-07-29T01:00:00.000Z',
      },
      {
        id: 'doc-project',
        projectId: 'project-1',
        goal: 'Inspect project',
        contentMarkdown: '# Project',
        status: 'completed',
        toolCallCount: 1,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ];
    const all = vi.fn().mockReturnValue(recentDocuments);
    const prepare = vi.fn(() => ({ all }));
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;
    const service = new CodeAnalysisService({ db, llm: {} as LLMProvider });

    await expect(service.listRecentDocuments(20)).resolves.toEqual(recentDocuments);
    await expect(service.listDocumentsByProject(null)).resolves.toEqual(recentDocuments);

    const calls = prepare.mock.calls as unknown as Array<[string]>;
    expect(calls[0][0]).not.toContain('WHERE project_id');
    expect(calls[0][0]).toContain('LIMIT ?');
    expect(all).toHaveBeenNthCalledWith(1, 20);
    expect(calls[1][0]).toContain('WHERE project_id IS NULL');

    await service.listRecentDocuments(0);
    await service.listRecentDocuments(500);
    expect(all).toHaveBeenNthCalledWith(3, 1);
    expect(all).toHaveBeenNthCalledWith(4, 100);
  });

  it('generates a no-project Markdown document without invoking directory tools', async () => {
    const localDocumentsPath = mkdtempSync(join(tmpdir(), 'ai-reader-local-documents-'));
    const row: Record<string, unknown> = {};
    const prepare = vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO analysis_documents')) {
          Object.assign(row, {
            id: args[0],
            projectId: args[1],
            goal: args[2],
            contentMarkdown: '',
            status: 'running',
            toolCallCount: 0,
            createdAt: args[3],
            updatedAt: args[4],
          });
        }
        if (sql.includes("status = 'completed'")) {
          Object.assign(row, {
            contentMarkdown: args[0],
            status: 'completed',
            modelId: args[1],
            toolCallCount: args[2],
            updatedAt: args[3],
          });
        }
        return {};
      }),
      get: vi.fn(() => (sql.includes('FROM analysis_documents') ? row : undefined)),
    }));
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;
    const llm = {
      chat: vi.fn(async () => ({
        id: 'response-1',
        content: '# Local document',
        model: 'mock-model',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      })),
    } as unknown as LLMProvider;

    try {
      const service = new CodeAnalysisService({ db, llm, localDocumentsPath });
      const document = await service.runAnalysis({
        projectId: null,
        goal: 'Write a local document',
      });

      expect(document.projectId).toBeNull();
      expect(document.toolCallCount).toBe(0);
      expect(llm.chat).toHaveBeenCalledTimes(1);
      const documentDirectories = readdirSync(localDocumentsPath);
      expect(documentDirectories).toHaveLength(1);
      expect(
        readFileSync(join(localDocumentsPath, documentDirectories[0], 'document.md'), 'utf8'),
      ).toBe('# Local document');
    } finally {
      rmSync(localDocumentsPath, { recursive: true, force: true });
    }
  });

  it('runs project tools, stores traces, and updates the project timestamp', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ai-reader-project-tools-'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}', 'utf8');
    const project = {
      id: 'project-1',
      name: 'Fixture',
      rootPath: root,
      rootPathHash: 'hash',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    const row: Record<string, unknown> = {};
    const traces: Array<Record<string, unknown>> = [];
    const projectUpdates: unknown[][] = [];
    let llmCalls = 0;
    const prepare = vi.fn((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes('FROM code_projects')) return project;
        if (sql.includes('FROM analysis_documents')) return row;
        return undefined;
      }),
      all: vi.fn(() => (sql.includes('FROM analysis_tool_traces') ? traces : [])),
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO analysis_documents')) {
          Object.assign(row, {
            id: args[0],
            projectId: args[1],
            goal: args[2],
            contentMarkdown: '',
            status: 'running',
            toolCallCount: 0,
            createdAt: args[3],
            updatedAt: args[4],
          });
        } else if (sql.includes('INSERT INTO analysis_tool_traces')) {
          traces.push({
            id: args[0],
            analysisDocumentId: args[1],
            stepIndex: args[2],
            toolName: args[3],
            toolArgsJson: args[4],
            resultSummary: args[5],
            createdAt: args[6],
          });
        } else if (sql.includes("status = 'completed'")) {
          Object.assign(row, {
            contentMarkdown: args[0],
            status: 'completed',
            modelId: args[1],
            toolCallCount: args[2],
            updatedAt: args[3],
          });
        } else if (sql.includes('UPDATE code_projects')) {
          projectUpdates.push(args);
        }
        return {};
      }),
    }));
    const llm = {
      chat: vi.fn(async () => {
        llmCalls += 1;
        return {
          id: `response-${llmCalls}`,
          content:
            llmCalls === 1
              ? JSON.stringify({ tool: 'listFiles', args: { path: '.', depth: 1 } })
              : '# Project document',
          model: 'mock-model',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }),
    } as unknown as LLMProvider;
    const db = {
      db: { prepare },
      close: vi.fn(),
    } as unknown as DatabaseClient;

    try {
      const service = new CodeAnalysisService({ db, llm });
      const document = await service.runAnalysis({
        projectId: project.id,
        goal: 'Inspect the project',
      });

      expect(document.status).toBe('completed');
      expect(document.toolCallCount).toBe(1);
      expect(projectUpdates).toHaveLength(1);
      await expect(service.listToolTraces(document.id)).resolves.toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists an English failure for a no-project provider error', async () => {
    const failures: unknown[][] = [];
    const db = {
      db: {
        prepare: vi.fn((sql: string) => ({
          run: vi.fn((...args: unknown[]) => {
            if (sql.includes("status = 'failed'")) failures.push(args);
            return {};
          }),
        })),
      },
    } as unknown as DatabaseClient;
    const llm = {
      chat: vi.fn(async () => {
        throw 'provider failed';
      }),
    } as unknown as LLMProvider;
    const service = new CodeAnalysisService({
      db,
      llm,
      settings: { getLanguage: () => 'en-US' },
    });

    await expect(
      service.runAnalysis({ projectId: null, goal: 'Write a document' }),
    ).rejects.toBe('provider failed');
    expect(failures[0][0]).toContain('# Analysis Failed');
    expect(failures[0][0]).toContain('Unknown analysis error');
  });

  it('rejects an empty no-project document instead of marking it completed', async () => {
    const failures: unknown[][] = [];
    const db = {
      db: {
        prepare: vi.fn((sql: string) => ({
          run: vi.fn((...args: unknown[]) => {
            if (sql.includes("status = 'failed'")) failures.push(args);
            return {};
          }),
          get: vi.fn(() =>
            sql.includes('FROM analysis_documents')
              ? {
                  id: 'doc-empty',
                  projectId: null,
                  goal: 'Write a document',
                  contentMarkdown: '  ',
                  status: 'completed',
                  modelId: 'mock-model',
                  toolCallCount: 0,
                  createdAt: '2026-07-29',
                  updatedAt: '2026-07-29',
                }
              : undefined,
          ),
        })),
      },
    } as unknown as DatabaseClient;
    const llm = {
      chat: vi.fn(async () => ({
        id: 'response-empty',
        content: '  ',
        model: 'mock-model',
        usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
        finishReason: 'stop',
      })),
    } as unknown as LLMProvider;
    const service = new CodeAnalysisService({ db, llm });

    await expect(
      service.runAnalysis({ projectId: null, goal: 'Write a document' }),
    ).rejects.toThrow('Model returned an empty document');
    expect(failures).toHaveLength(1);
  });

  it('does not complete a no-project document without a local storage path', async () => {
    const failures: unknown[][] = [];
    const db = {
      db: {
        prepare: vi.fn((sql: string) => ({
          run: vi.fn((...args: unknown[]) => {
            if (sql.includes("status = 'failed'")) failures.push(args);
            return {};
          }),
          get: vi.fn(() => ({
            id: 'doc-local',
            projectId: null,
            goal: 'Write a document',
            contentMarkdown: '# Local',
            status: 'completed',
            modelId: 'mock-model',
            toolCallCount: 0,
            createdAt: '2026-07-29',
            updatedAt: '2026-07-29',
          })),
        })),
      },
    } as unknown as DatabaseClient;
    const llm = {
      chat: vi.fn(async () => ({
        id: 'response-local',
        content: '# Local',
        model: 'mock-model',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      })),
    } as unknown as LLMProvider;
    const service = new CodeAnalysisService({ db, llm });

    await expect(
      service.runAnalysis({ projectId: null, goal: 'Write a document' }),
    ).rejects.toThrow('Local documents path is not configured');
    expect(failures).toHaveLength(1);
  });

  it('rejects a project analysis when the project no longer exists', async () => {
    const db = {
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => undefined),
        })),
      },
    } as unknown as DatabaseClient;
    const service = new CodeAnalysisService({ db, llm: {} as LLMProvider });

    await expect(service.getDocument('missing-document')).resolves.toBeNull();
    await expect(
      service.runAnalysis({ projectId: 'missing-project', goal: 'Inspect it' }),
    ).rejects.toThrow('Code project not found: missing-project');
  });

  it('marks the generated row failed when it cannot be reloaded', async () => {
    const localDocumentsPath = mkdtempSync(join(tmpdir(), 'ai-reader-missing-document-'));
    const failedUpdates: unknown[][] = [];
    const db = {
      db: {
        prepare: vi.fn((sql: string) => ({
          get: vi.fn(() => undefined),
          run: vi.fn((...args: unknown[]) => {
            if (sql.includes("status = 'failed'")) failedUpdates.push(args);
            return {};
          }),
        })),
      },
    } as unknown as DatabaseClient;
    const llm = {
      chat: vi.fn(async () => ({
        id: 'response-1',
        content: '# Generated',
        model: 'mock-model',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      })),
    } as unknown as LLMProvider;
    const service = new CodeAnalysisService({ db, llm, localDocumentsPath });

    try {
      await expect(
        service.runAnalysis({ projectId: null, goal: 'Generate' }),
      ).rejects.toThrow('Analysis document not found after creation');
      expect(failedUpdates).toHaveLength(1);
    } finally {
      rmSync(localDocumentsPath, { recursive: true, force: true });
    }
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
      expect(failureUpdate?.args[0]).toContain('# 分析失败');
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
