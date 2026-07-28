import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  LLMProvider,
} from '@ai-reader/core';

import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisAnnotationService } from '../annotation-service';
import { AnalysisExportService } from '../export-service';
import { AnalysisReplyEngine } from '../reply-engine';
import { CodeAnalysisService } from '../service';

class E2EMockLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-code-model';
  private chatCalls = 0;

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.chatCalls += 1;
    const content =
      this.chatCalls === 1
        ? JSON.stringify({ tool: 'readFile', args: { path: 'src/startup.ts' } })
        : '# Startup Report\n\nBoot path initializes the app from `src/startup.ts`.';
    return {
      id: `chat-${this.chatCalls}`,
      content,
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }

  async *chatStream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    yield {
      id: 'stream-1',
      delta: 'It refers to the startup module read from the selected project.',
      done: false,
    };
    yield { id: 'stream-2', delta: '', done: true, finishReason: 'stop' };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('code analysis MVP flow', () => {
  let db: DatabaseClient;
  let projectDir: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    projectDir = join(tmpdir(), `ai-reader-code-analysis-${Date.now()}`);
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'startup.ts'), 'export function boot() { return "ready"; }\n');
  });

  afterEach(() => {
    db.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('runs analysis, stores a replied annotation, and exports/imports the annotated document', async () => {
    const llm = new E2EMockLLM();
    const analysisService = new CodeAnalysisService({ db, llm });
    const annotationService = new AnalysisAnnotationService(db);
    const replyEngine = new AnalysisReplyEngine({ db, llm, annotationService });
    const exportService = new AnalysisExportService(db);

    const project = await analysisService.createProject(projectDir);
    const document = await analysisService.runAnalysis({
      projectId: project.id,
      goal: 'Explain startup behavior',
    });

    expect(document.status).toBe('completed');
    expect(document.contentMarkdown).toContain('Boot path');
    expect(await analysisService.listToolTraces(document.id)).toHaveLength(1);

    const annotation = await annotationService.create({
      analysisDocumentId: document.id,
      selectedText: 'Boot path',
      question: 'What does this mean?',
    });
    const replyEvents = [];
    for await (const event of replyEngine.generateReply({ annotationId: annotation.id })) {
      replyEvents.push(event);
    }

    expect(replyEvents.at(-1)).toEqual({ type: 'done' });
    const messages = await annotationService.listMessages(annotation.id);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect((await annotationService.getById(annotation.id))?.status).toBe('answered');

    const exported = await exportService.exportJson(document.id);
    expect(exported.annotations).toHaveLength(1);
    expect(exported.discussionMessages).toHaveLength(2);
    expect(JSON.stringify(exported)).not.toContain(projectDir);

    const importedDb = createDatabase(':memory:');
    try {
      const imported = await new AnalysisExportService(importedDb).importJson(exported);
      expect(imported.contentMarkdown).toContain('Startup Report');
      const restored = importedDb.db
        .prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages')
        .get();
      expect(restored).toEqual({ count: 2 });
    } finally {
      importedDb.close();
    }
  });
});
