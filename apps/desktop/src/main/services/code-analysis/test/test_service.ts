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
});
