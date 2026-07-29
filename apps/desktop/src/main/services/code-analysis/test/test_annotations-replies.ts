import type { ChatCompletionChunk, ChatCompletionRequest, ChatMessage, LLMProvider } from '@ai-reader/core';
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

/** LLM mock that captures the messages sent to it for assertion. */
class CapturingReplyLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-reply';
  capturedMessages: ChatMessage[] = [];

  async chat(): Promise<any> {
    throw new Error('not used');
  }

  async *chatStream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    this.capturedMessages = request.messages;
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
        `INSERT INTO analysis_sessions (id, project_id, title, status, created_at, updated_at)
         VALUES ('session-base', 'project-1', 'Base Session', 'active', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
         VALUES ('branch-base', 'session-base', 'Main', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `
      INSERT INTO analysis_documents
        (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'session-base', 'branch-base', 'Explain architecture', '# Architecture\n\nThe main process owns IPC.', 'completed', 'mock', 0, ?, ?)
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

  it('reply to turn 2 includes turn 2 content and excludes sibling branch content', async () => {
    const now = new Date().toISOString();

    // Create session with two branches
    db.db
      .prepare(
        `INSERT INTO analysis_sessions (id, project_id, title, status, created_at, updated_at)
         VALUES ('session-1', 'project-1', 'Test Session', 'active', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
         VALUES ('branch-a', 'session-1', 'Main', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
         VALUES ('branch-b', 'session-1', 'Sibling', ?, ?)`,
      )
      .run(now, now);

    // Turn 1 on branch A
    db.db
      .prepare(
        `INSERT INTO analysis_documents
           (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('turn-1', 'session-1', 'branch-a', 'Goal 1', '# Turn 1\n\nFirst analysis.', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);

    // Turn 2 on branch A (child of turn 1)
    db.db
      .prepare(
        `INSERT INTO analysis_documents
           (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('turn-2', 'session-1', 'branch-a', 'turn-1', 'Goal 2', '# Turn 2\n\nSecond analysis content.', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);

    // Sibling document on branch B — should NOT appear in reply context
    db.db
      .prepare(
        `INSERT INTO analysis_documents
           (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('sibling-1', 'session-1', 'branch-b', 'Goal 3', '# Sibling\n\nShould not appear.', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);

    const annotations = new AnalysisAnnotationService(db);
    const annotation = await annotations.create({
      analysisDocumentId: 'turn-2',
      selectedText: 'Second analysis',
      question: 'What about turn 2?',
    });

    const llm = new CapturingReplyLLM();
    const engine = new AnalysisReplyEngine({ db, llm, annotationService: annotations });
    const chunks: string[] = [];
    for await (const event of engine.generateReply({ annotationId: annotation.id })) {
      if (event.type === 'text') chunks.push(event.content);
    }

    expect(chunks.join('')).toBe('This explains it.');

    // The user message sent to LLM must contain turn 2 content
    const userMsg = llm.capturedMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('Second analysis content');
    // Must NOT contain sibling branch content
    expect(userMsg!.content).not.toContain('Should not appear');
  });

  it('reply fetches project metadata through session join', async () => {
    const now = new Date().toISOString();

    // Add a second project to prove we use the session join, not document.project_id
    db.db
      .prepare(
        `INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
         VALUES ('project-other', 'WrongProject', '/other', 'hash-other', ?, ?)`,
      )
      .run(now, now);

    // Session links to project-1 ("Project")
    db.db
      .prepare(
        `INSERT INTO analysis_sessions (id, project_id, title, status, created_at, updated_at)
         VALUES ('session-1', 'project-1', 'Session via correct project', 'active', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
         VALUES ('branch-1', 'session-1', 'Main', ?, ?)`,
      )
      .run(now, now);

    // Document belongs to session-1 which links to project-1 ("Project").
    // The reply engine should resolve project via session.
    db.db
      .prepare(
        `INSERT INTO analysis_documents
           (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('doc-session', 'session-1', 'branch-1', 'Test goal', '# Content', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);

    const annotations = new AnalysisAnnotationService(db);
    const annotation = await annotations.create({
      analysisDocumentId: 'doc-session',
      selectedText: 'Content',
      question: 'Explain this',
    });

    const llm = new CapturingReplyLLM();
    const engine = new AnalysisReplyEngine({ db, llm, annotationService: annotations });
    for await (const event of engine.generateReply({ annotationId: annotation.id })) {
      // drain
    }

    // The system or user message should include project name from session join ("Project"),
    // NOT "WrongProject" from document.project_id
    const allContent = llm.capturedMessages.map((m) => m.content).join('\n');
    expect(allContent).toContain('Project');
    expect(allContent).not.toContain('WrongProject');
  });

  it('reply includes ordered discussion history', async () => {
    const now = new Date().toISOString();

    db.db
      .prepare(
        `INSERT INTO analysis_sessions (id, project_id, title, status, created_at, updated_at)
         VALUES ('session-1', 'project-1', 'Test Session', 'active', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
         VALUES ('branch-1', 'session-1', 'Main', ?, ?)`,
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_documents
           (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
         VALUES ('doc-hist', 'session-1', 'branch-1', 'Explain', '# Doc', 'completed', 'mock', 0, ?, ?)`,
      )
      .run(now, now);

    const annotations = new AnalysisAnnotationService(db);
    const annotation = await annotations.create({
      analysisDocumentId: 'doc-hist',
      selectedText: 'Doc',
      question: 'First question?',
    });

    // Simulate a prior AI reply so there is discussion history
    await annotations.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content: 'Prior AI answer.',
    });

    const llm = new CapturingReplyLLM();
    const engine = new AnalysisReplyEngine({ db, llm, annotationService: annotations });
    for await (const event of engine.generateReply({ annotationId: annotation.id })) {
      // drain
    }

    // The user message should contain the discussion history
    const userMsg = llm.capturedMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain('First question?');
    expect(userMsg!.content).toContain('Prior AI answer.');
  });
});
