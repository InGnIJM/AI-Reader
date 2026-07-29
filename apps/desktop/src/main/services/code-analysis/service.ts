import { createHash, randomUUID } from 'crypto';
import { basename } from 'path';
import type { LLMProvider } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

import type { DatabaseClient } from '../../db/client';
import type { SettingsService } from '../settings-service';
import { buildProjectContext } from './context-builder';
import { buildAnalysisMessages } from './prompt-builder';
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
    },
  ) {}

  async createProject(rootPath: string): Promise<CodeProject> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const name = basename(rootPath);
    const rootPathHash = createHash('sha256').update(rootPath).digest('hex');

    this.deps.db.db
      .prepare(
        `
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(id, name, rootPath, rootPathHash, now, now);

    return { id, name, rootPath, rootPathHash, createdAt: now, updatedAt: now };
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
      SELECT id, name, root_path AS rootPath, root_path_hash AS rootPathHash,
             created_at AS createdAt, updated_at AS updatedAt
      FROM code_projects
      ORDER BY updated_at DESC
    `,
      )
      .all() as CodeProject[];
  }

  async listDocumentsByProject(projectId: string): Promise<AnalysisDocument[]> {
    return this.deps.db.db
      .prepare(
        `
      SELECT id, project_id AS projectId, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents
      WHERE project_id = ?
      ORDER BY updated_at DESC
    `,
      )
      .all(projectId) as AnalysisDocument[];
  }

  async runAnalysis(input: { projectId: string; goal: string }): Promise<AnalysisDocument> {
    const project = await this.getProject(input.projectId);
    if (!project) throw new Error(`Code project not found: ${input.projectId}`);

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
      .run(docId, project.id, input.goal, now, now);

    let outputLanguage: AppLanguage = 'zh-CN';
    try {
      outputLanguage = this.deps.settings?.getLanguage() ?? 'zh-CN';
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
        goal: input.goal,
        projectContext,
        traceSummary: 'No tools used yet.',
        outputLanguage,
      });
      const result = await runCodeAnalysisToolLoop({
        llm: this.deps.llm,
        messages,
        executeTool: (name, args) => tools.execute(name, args),
        maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
        outputLanguage,
      });

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
      this.deps.db.db
        .prepare('UPDATE code_projects SET updated_at = ? WHERE id = ?')
        .run(doneAt, project.id);

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
      this.deps.db.db
        .prepare('UPDATE code_projects SET updated_at = ? WHERE id = ?')
        .run(failedAt, project.id);
      throw error;
    }
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
