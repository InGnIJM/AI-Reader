import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider } from '@ai-reader/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { CodeAnalysisService } from '../service';

class OneToolThenMarkdownLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  private calls = 0;

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls += 1;
    return {
      id: `resp-${this.calls}`,
      content:
        this.calls === 1
          ? JSON.stringify({ tool: 'listFiles', args: { path: '.', depth: 1 } })
          : '# Project Summary\n\nUses `package.json`.',
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }

  chatStream(): AsyncIterable<any> {
    throw new Error('not used');
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('CodeAnalysisService', () => {
  let db: DatabaseClient;
  let root: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    root = mkdtempSync(join(tmpdir(), 'ai-reader-project-'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a project, runs analysis, stores Markdown and tool traces', async () => {
    const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
    const project = await service.createProject(root);
    const document = await service.runAnalysis({ projectId: project.id, goal: 'Summarize project' });

    expect(document.status).toBe('completed');
    expect(document.contentMarkdown).toContain('# Project Summary');
    expect(document.toolCallCount).toBe(1);

    const traces = await service.listToolTraces(document.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].toolName).toBe('listFiles');
    expect(traces[0].resultSummary).toContain('package.json');
  });

  describe('runTurn', () => {
    it('first send creates session + branch + turn atomically', async () => {
      const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
      const project = await service.createProject(root);

      const result = await service.runTurn({
        projectId: project.id,
        goal: 'Analyze architecture',
      });

      expect(result.session.id).toBeDefined();
      expect(result.session.title).toBe('Analyze architecture');
      expect(result.branch.id).toBeDefined();
      expect(result.branch.name).toBe('主分支');
      expect(result.turn.id).toBeDefined();
      expect(result.turn.goal).toBe('Analyze architecture');
      expect(result.turn.sessionId).toBe(result.session.id);
      expect(result.turn.branchId).toBe(result.branch.id);
      expect(result.turn.status).toBe('completed');
    });

    it('second send appends to same session', async () => {
      const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
      const project = await service.createProject(root);

      const first = await service.runTurn({
        projectId: project.id,
        goal: 'First question',
      });

      const second = await service.runTurn({
        sessionId: first.session.id,
        goal: 'Second question',
      });

      expect(second.session.id).toBe(first.session.id);
      expect(second.turn.parentDocumentId).toBe(first.turn.id);
      expect(second.branch.id).toBe(first.branch.id);
    });

    it('from history auto-forks new branch', async () => {
      const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
      const project = await service.createProject(root);

      const first = await service.runTurn({
        projectId: project.id,
        goal: 'First',
      });

      const second = await service.runTurn({
        sessionId: first.session.id,
        goal: 'Second',
      });

      // Fork from first turn (not branch head)
      const fork = await service.runTurn({
        sessionId: first.session.id,
        parentDocumentId: first.turn.id,
        goal: 'Alternative path',
      });

      expect(fork.session.id).toBe(first.session.id);
      expect(fork.branch.id).not.toBe(first.branch.id);
      expect(fork.turn.parentDocumentId).toBe(first.turn.id);
    });

    it('forceFork creates branch even from head', async () => {
      const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
      const project = await service.createProject(root);

      const first = await service.runTurn({
        projectId: project.id,
        goal: 'First',
      });

      const fork = await service.runTurn({
        sessionId: first.session.id,
        parentDocumentId: first.turn.id,
        goal: 'Explicit fork',
        forceFork: true,
      });

      expect(fork.branch.id).not.toBe(first.branch.id);
      expect(fork.turn.parentDocumentId).toBe(first.turn.id);
    });

    it('failure retains failed turn', async () => {
      class FailingLLM implements LLMProvider {
        readonly name = 'failing';
        readonly defaultModel = 'fail-model';
        async chat(): Promise<ChatCompletionResponse> {
          throw new Error('Model overloaded');
        }
        chatStream(): AsyncIterable<any> {
          throw new Error('not used');
        }
        async validateApiKey(): Promise<boolean> {
          return true;
        }
      }

      const service = new CodeAnalysisService({ db, llm: new FailingLLM() });
      const project = await service.createProject(root);

      await expect(
        service.runTurn({ projectId: project.id, goal: 'Will fail' })
      ).rejects.toThrow('Model overloaded');

      // Verify the failed turn exists
      const sessions = db.db
        .prepare('SELECT id FROM analysis_sessions WHERE project_id = ?')
        .all(project.id) as Array<{ id: string }>;
      expect(sessions).toHaveLength(1);

      const turns = db.db
        .prepare('SELECT status FROM analysis_documents WHERE session_id = ?')
        .all(sessions[0].id) as Array<{ status: string }>;
      expect(turns).toHaveLength(1);
      expect(turns[0].status).toBe('failed');
    });

    it('no-project creates local document', async () => {
      const service = new CodeAnalysisService({
        db,
        llm: new OneToolThenMarkdownLLM(),
        localDocumentsPath: join(root, 'local-docs'),
      });

      const result = await service.runTurn({
        projectId: null,
        goal: 'Generate local document',
      });

      expect(result.session.id).toBeDefined();
      expect(result.turn.goal).toBe('Generate local document');
    });
  });
});
