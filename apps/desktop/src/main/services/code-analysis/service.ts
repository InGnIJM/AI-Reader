import { mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import type { LLMProvider } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

import type { DatabaseClient } from '../../db/client';
import {
  hashProjectRootPath,
  normalizeProjectRootPath,
} from '../../db/code-analysis-migration';
import type { SettingsService } from '../settings-service';
import { buildProjectContext } from './context-builder';
import { buildAnalysisMessages, buildLocalDocumentMessages } from './prompt-builder';
import { CodeAnalysisToolRegistry } from './tool-registry';
import { runCodeAnalysisToolLoop } from './tool-loop';
import type { AnalysisDocument, AnalysisToolTrace, CodeProject } from './types';

const DEFAULT_MAX_TOOL_CALLS = 15;

export class CodeAnalysisService {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      llm: LLMProvider;
      settings?: Pick<SettingsService, 'getLanguage'>;
      localDocumentsPath?: string;
      projectPathHash?: (rootPath: string) => string;
    },
  ) {}

  async createProject(rootPath: string): Promise<CodeProject> {
    const normalizedRootPath = normalizeProjectRootPath(rootPath);
    const rootPathHash =
      this.deps.projectPathHash?.(normalizedRootPath) ?? hashProjectRootPath(normalizedRootPath);
    const existing = this.deps.db.db
      .prepare(
        `
      SELECT id, name, root_path AS rootPath, root_path_hash AS rootPathHash,
             (SELECT COUNT(*) FROM analysis_documents WHERE project_id = code_projects.id)
               AS conversationCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM code_projects WHERE root_path_hash = ?
    `,
      )
      .get(rootPathHash) as CodeProject | undefined;
    if (existing) return existing;

    const id = randomUUID();
    const now = new Date().toISOString();
    const name = basename(normalizedRootPath);

    this.deps.db.db
      .prepare(
        `
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(id, name, normalizedRootPath, rootPathHash, now, now);

    return {
      id,
      name,
      rootPath: normalizedRootPath,
      rootPathHash,
      conversationCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getProject(id: string): Promise<CodeProject | null> {
    const row = this.deps.db.db
      .prepare(
        `
      SELECT id, name, root_path AS rootPath, root_path_hash AS rootPathHash,
             created_at AS createdAt, updated_at AS updatedAt
      FROM code_projects WHERE id = ?
    `,
      )
      .get(id) as CodeProject | undefined;
    return row ?? null;
  }

  async listProjects(): Promise<CodeProject[]> {
    return this.deps.db.db
      .prepare(
        `
      SELECT p.id, p.name, p.root_path AS rootPath, p.root_path_hash AS rootPathHash,
             COUNT(d.id) AS conversationCount,
             p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM code_projects p
      LEFT JOIN analysis_documents d ON d.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `,
      )
      .all() as CodeProject[];
  }

  async listDocumentsByProject(projectId: string | null): Promise<AnalysisDocument[]> {
    const whereClause = projectId === null ? 'project_id IS NULL' : 'project_id = ?';
    const statement = this.deps.db.db.prepare(`
      SELECT id, project_id AS projectId, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents
      WHERE ${whereClause}
      ORDER BY updated_at DESC
    `);
    return (projectId === null ? statement.all() : statement.all(projectId)) as AnalysisDocument[];
  }

  async listRecentDocuments(limit = 20): Promise<AnalysisDocument[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    return this.deps.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      )
      .all(safeLimit) as AnalysisDocument[];
  }

  async runAnalysis(input: {
    projectId: string | null;
    goal: string;
  }): Promise<AnalysisDocument> {
    const project = input.projectId ? await this.getProject(input.projectId) : null;
    if (input.projectId && !project) {
      throw new Error(`Code project not found: ${input.projectId}`);
    }

    const docId = randomUUID();
    const now = new Date().toISOString();
    this.deps.db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, '', 'running', 0, ?, ?)
    `,
      )
      .run(docId, project?.id ?? null, input.goal, now, now);

    let outputLanguage: AppLanguage = 'zh-CN';
    try {
      outputLanguage = this.deps.settings?.getLanguage() ?? 'zh-CN';
      const result = project
        ? await this.runProjectAnalysis(project, input.goal, outputLanguage)
        : await this.runLocalDocument(input.goal, outputLanguage);
      const localDocumentsPath = this.deps.localDocumentsPath?.trim();
      if (!project && !localDocumentsPath) {
        throw new Error('Local documents path is not configured');
      }

      const traceInsert = this.deps.db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
      for (const trace of result.traces) {
        traceInsert.run(
          randomUUID(),
          docId,
          trace.stepIndex,
          trace.toolName,
          JSON.stringify(trace.toolArgs),
          trace.resultSummary,
          new Date().toISOString(),
        );
      }

      const doneAt = new Date().toISOString();
      this.deps.db.db
        .prepare(
          `
      UPDATE analysis_documents
      SET content_markdown = ?, status = 'completed', model_id = ?, tool_call_count = ?, updated_at = ?
      WHERE id = ?
    `,
        )
        .run(result.markdown, result.modelId, result.traces.length, doneAt, docId);
      if (project) {
        this.deps.db.db
          .prepare('UPDATE code_projects SET updated_at = ? WHERE id = ?')
          .run(doneAt, project.id);
      } else {
        const outputDirectory = join(localDocumentsPath!, docId);
        mkdirSync(outputDirectory, { recursive: true });
        writeFileSync(join(outputDirectory, 'document.md'), result.markdown, 'utf8');
      }

      const document = await this.getDocument(docId);
      if (!document) throw new Error(`Analysis document not found after creation: ${docId}`);
      return document;
    } catch (error) {
      const failedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : 'Unknown analysis error';
      const failureMarkdown =
        outputLanguage === 'zh-CN'
          ? `# 分析失败\n\n${errorMessage}`
          : `# Analysis Failed\n\n${errorMessage}`;
      this.deps.db.db
        .prepare(
          `
        UPDATE analysis_documents
        SET content_markdown = ?, status = 'failed', updated_at = ?
        WHERE id = ?
      `,
        )
        .run(failureMarkdown, failedAt, docId);
      if (project) {
        this.deps.db.db
          .prepare('UPDATE code_projects SET updated_at = ? WHERE id = ?')
          .run(failedAt, project.id);
      }
      throw error;
    }
  }

  private async runProjectAnalysis(
    project: CodeProject,
    goal: string,
    outputLanguage: AppLanguage,
  ) {
    const tools = new CodeAnalysisToolRegistry(project.rootPath);
    const fileIndex = (await tools.execute('listFiles', { path: '.', depth: 2 })).content
      .split('\n')
      .filter(Boolean);
    const projectContext = buildProjectContext({
      projectName: project.name,
      rootPathHash: project.rootPathHash,
      fileIndex,
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
    });
    const messages = buildAnalysisMessages({
      goal,
      projectContext,
      traceSummary: 'No tools used yet.',
      outputLanguage,
    });
    return runCodeAnalysisToolLoop({
      llm: this.deps.llm,
      messages,
      executeTool: (name, args) => tools.execute(name, args),
      maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
      outputLanguage,
    });
  }

  private async runLocalDocument(goal: string, outputLanguage: AppLanguage) {
    const response = await this.deps.llm.chat({
      messages: buildLocalDocumentMessages({ goal, outputLanguage }),
    });
    const markdown = response.content.trim();
    if (!markdown) {
      throw new Error('Model returned an empty document');
    }
    return {
      markdown,
      modelId: response.model,
      traces: [],
    };
  }

  async getDocument(id: string): Promise<AnalysisDocument | null> {
    const row = this.deps.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents WHERE id = ?
    `,
      )
      .get(id) as AnalysisDocument | undefined;
    return row ?? null;
  }

  async listToolTraces(documentId: string): Promise<AnalysisToolTrace[]> {
    return this.deps.db.db
      .prepare(
        `
      SELECT id, analysis_document_id AS analysisDocumentId, step_index AS stepIndex,
             tool_name AS toolName, tool_args_json AS toolArgsJson,
             result_summary AS resultSummary, created_at AS createdAt
      FROM analysis_tool_traces
      WHERE analysis_document_id = ?
      ORDER BY step_index ASC
    `,
      )
      .all(documentId) as AnalysisToolTrace[];
  }
}
