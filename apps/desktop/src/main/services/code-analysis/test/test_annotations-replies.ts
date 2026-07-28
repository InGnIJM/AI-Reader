import type { ChatCompletionChunk, ChatCompletionRequest, LLMProvider } from '@ai-reader/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisAnnotationService } from '../annotation-service';
import { AnalysisReplyEngine } from '../reply-engine';

class StreamingReplyLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-reply';

  async chat(): Promise<any> {
    throw new Error('not used');
  }

  async *chatStream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    yield { id: '1', delta: 'This ', done: false };
    yield { id: '2', delta: 'explains it.', done: false };
    yield {
      id: '3',
      delta: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      finishReason: 'stop',
    };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('analysis annotations and replies', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const now = new Date().toISOString();
    db.db
      .prepare(
        `
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES ('project-1', 'Project', 'root', 'hash', ?, ?)
    `,
      )
      .run(now, now);
    db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'project-1', 'Explain architecture', '# Architecture\n\nThe main process owns IPC.', 'completed', 'mock', 0, ?, ?)
    `,
      )
      .run(now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a comment anchor and auto-saves an AI reply', async () => {
    const annotations = new AnalysisAnnotationService(db);
    const annotation = await annotations.create({
      analysisDocumentId: 'doc-1',
      selectedText: 'main process',
      question: 'What does this mean?',
    });

    expect(annotation.anchorStartOffset).toBeGreaterThanOrEqual(0);
    expect(annotation.anchorExactText).toBe('main process');
    expect(annotation.status).toBe('pending');

    const engine = new AnalysisReplyEngine({ db, llm: new StreamingReplyLLM(), annotationService: annotations });
    const chunks: string[] = [];
    for await (const event of engine.generateReply({ annotationId: annotation.id })) {
      if (event.type === 'text') chunks.push(event.content);
    }

    expect(chunks.join('')).toBe('This explains it.');
    const messages = await annotations.listMessages(annotation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('This explains it.');
    expect((await annotations.getById(annotation.id))!.status).toBe('answered');
  });
});
