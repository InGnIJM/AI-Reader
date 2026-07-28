import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIReplyEngine } from './index';
import type { AIReplyStreamEvent } from './index';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { AnnotationService } from '../annotation';
import { DiscussionService } from '../discussion';
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionChunk,
  StreamIterator,
} from '@ai-reader/core';

// ── Mock LLM Provider ───────────────────────────────────────────────────

function createMockLLM(overrides?: {
  streamChunks?: ChatCompletionChunk[];
  streamError?: Error;
  defaultModel?: string;
}): LLMProvider {
  const streamChunks: ChatCompletionChunk[] = overrides?.streamChunks ?? [
    { id: '1', delta: '这是', done: false },
    { id: '2', delta: 'AI 的回复。', done: false },
    {
      id: '3',
      delta: '',
      done: true,
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    },
  ];

  return {
    name: 'mock',
    defaultModel: overrides?.defaultModel ?? 'mock-model',
    chat: async () => ({
      id: 'mock-id',
      content: 'mock',
      model: 'mock-model',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop' as const,
    }),
    chatStream: async function* (_request: ChatCompletionRequest): StreamIterator {
      if (overrides?.streamError) {
        throw overrides.streamError;
      }
      for (const chunk of streamChunks) {
        yield chunk;
      }
    },
    validateApiKey: async () => true,
  };
}

// ── Test Data Seeding ────────────────────────────────────────────────────

function seedTestData(db: DatabaseClient) {
  const now = new Date().toISOString();

  db.db
    .prepare(
      `INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run('ws-1', 'Test Workspace', now, now);

  db.db
    .prepare(
      `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, title, raw_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('doc-1', 'ws-1', 'test.md', 'markdown', 'hash', 'Test Doc', 'content', 'ready', now, now);

  db.db
    .prepare(
      `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('art-1', 'doc-1', '学习导读：编译原理', 'completed', now, now);

  db.db
    .prepare(
      `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'sec-1',
      'art-1',
      0,
      '第一章：词法分析',
      '[]',
      '# 词法分析\n\n词法分析是编译器的第一个阶段，负责将源代码字符流转换为标记（token）序列。\n\n## 有限自动机\n\n有限自动机（Finite Automaton）是词法分析的核心理论基础。它分为确定性有限自动机（DFA）和非确定性有限自动机（NFA）两种。',
      'completed',
      now,
      now,
    );

  db.db
    .prepare(
      `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'ann-1',
      'art-1',
      'sec-1',
      60,
      78,
      '确定性有限自动机（DFA）',
      '它分为',
      '和非确定性有限自动',
      'question',
      'DFA 和 NFA 有什么区别？',
      now,
      now,
    );

  // 批注 2：没有 content 的 highlight
  db.db
    .prepare(
      `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'ann-2',
      'art-1',
      'sec-1',
      0,
      4,
      '词法分析',
      '',
      '是编译器的',
      'highlight',
      null,
      now,
      now,
    );
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('AIReplyEngine', () => {
  let db: DatabaseClient;
  let annotationService: AnnotationService;
  let discussionService: DiscussionService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    seedTestData(db);
    annotationService = new AnnotationService(db);
    discussionService = new DiscussionService(db);
  });

  afterEach(() => {
    db.close();
  });

  function createEngine(llmOverrides?: Parameters<typeof createMockLLM>[0]) {
    return new AIReplyEngine({
      llm: createMockLLM(llmOverrides),
      db,
      annotationService,
      discussionService,
    });
  }

  async function collectEvents(
    engine: AIReplyEngine,
    context: { annotationId: string; userMessage?: string },
  ): Promise<AIReplyStreamEvent[]> {
    const events: AIReplyStreamEvent[] = [];
    for await (const event of engine.generateReply(context)) {
      events.push(event);
    }
    return events;
  }

  // ── 基本流式回复 ──────────────────────────────────────────────────────

  describe('generateReply - basic streaming', () => {
    it('should yield text events and a done event', async () => {
      const engine = createEngine();
      const events = await collectEvents(engine, { annotationId: 'ann-1' });

      expect(events).toHaveLength(3); // 2 text + 1 done
      expect(events[0]).toEqual({ type: 'text', content: '这是' });
      expect(events[1]).toEqual({ type: 'text', content: 'AI 的回复。' });
      expect(events[2]).toEqual({
        type: 'done',
        usage: { inputTokens: 100, outputTokens: 20 },
      });
    });

    it('should save assistant message to database after streaming', async () => {
      const engine = createEngine();
      const events: AIReplyStreamEvent[] = [];
      for await (const event of engine.generateReply({ annotationId: 'ann-1' })) {
        events.push(event);
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toBe('这是AI 的回复。');
      expect(messages[0].modelId).toBe('mock-model');
    });

    it('should save token usage as JSON string', async () => {
      const engine = createEngine();
      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      expect(messages[0].tokenUsage).toBe('{"input":100,"output":20}');
    });
  });

  // ── 用户追问 ──────────────────────────────────────────────────────────

  describe('generateReply - user follow-up', () => {
    it('should save user message before generating reply', async () => {
      const engine = createEngine();
      for await (const _ of engine.generateReply({
        annotationId: 'ann-1',
        userMessage: '能详细解释一下吗？',
      })) {
        // consume
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('能详细解释一下吗？');
      expect(messages[1].role).toBe('assistant');
    });

    it('should include conversation history in LLM context', async () => {
      // 先添加一轮对话
      await discussionService.addMessage({
        annotationId: 'ann-1',
        role: 'user',
        content: '第一轮问题',
      });
      await discussionService.addMessage({
        annotationId: 'ann-1',
        role: 'assistant',
        content: '第一轮回答',
      });

      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({
        annotationId: 'ann-1',
        userMessage: '第二轮追问',
      })) {
        // consume
      }

      expect(capturedRequest).toBeDefined();
      const msgs = capturedRequest!.messages;
      // system + 2 history messages (first round) + user prompt
      expect(msgs.length).toBeGreaterThanOrEqual(3);
      expect(msgs[0].role).toBe('system');
      // 第一轮对话应该在 history 中
      const historyMsgs = msgs.filter((m) => m.role !== 'system');
      expect(historyMsgs.some((m) => m.content === '第一轮问题')).toBe(true);
      expect(historyMsgs.some((m) => m.content === '第一轮回答')).toBe(true);
    });
  });

  // ── 上下文构建 ────────────────────────────────────────────────────────

  describe('generateReply - context building', () => {
    it('should include section content in system prompt', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const systemMsg = capturedRequest!.messages[0].content;
      expect(systemMsg).toContain('第一章：词法分析');
      expect(systemMsg).toContain('词法分析是编译器的第一个阶段');
      expect(systemMsg).toContain('学习导读：编译原理');
    });

    it('should include annotation exact text in system prompt', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const systemMsg = capturedRequest!.messages[0].content;
      expect(systemMsg).toContain('确定性有限自动机（DFA）');
    });

    it('should include annotation content in user prompt', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const userMsg = capturedRequest!.messages.find((m) => m.role === 'user')!.content;
      expect(userMsg).toContain('DFA 和 NFA 有什么区别？');
    });

    it('should truncate long section content to 3000 chars', async () => {
      // 插入一个超长章节
      const now = new Date().toISOString();
      const longContent = 'A'.repeat(5000);
      db.db
        .prepare(
          `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('sec-long', 'art-1', 1, 'Long Section', '[]', longContent, 'completed', now, now);

      db.db
        .prepare(
          `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('ann-long', 'art-1', 'sec-long', 0, 3, 'AAA', '', 'AAA', 'note', 'test', now, now);

      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-long' })) {
        // consume
      }

      const systemMsg = capturedRequest!.messages[0].content;
      expect(systemMsg).toContain('[... 内容已截断]');
      // 5000 chars should be truncated
      expect(systemMsg.length).toBeLessThan(longContent.length + 500);
    });
  });

  // ── 高亮批注（无 content） ─────────────────────────────────────────────

  describe('generateReply - highlight annotation without content', () => {
    it('should generate default prompt for highlight without content', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();
      const spyLLM: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const engine = new AIReplyEngine({
        llm: spyLLM,
        db,
        annotationService,
        discussionService,
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-2' })) {
        // consume
      }

      const userMsg = capturedRequest!.messages.find((m) => m.role === 'user')!.content;
      expect(userMsg).toContain('请解释一下这段内容');
      expect(userMsg).toContain('词法分析');
    });
  });

  // ── 错误处理 ──────────────────────────────────────────────────────────

  describe('generateReply - error handling', () => {
    it('should yield error when annotation not found', async () => {
      const engine = createEngine();
      const events = await collectEvents(engine, {
        annotationId: 'non-existent',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Annotation not found: non-existent',
      });
    });

    it('should yield error when section not found', async () => {
      // Temporarily disable foreign keys to insert orphan annotation
      db.db.pragma('foreign_keys = OFF');
      const now = new Date().toISOString();
      db.db
        .prepare(
          `INSERT INTO annotations (id, article_id, section_id, anchor_start_offset, anchor_end_offset, anchor_exact_text, anchor_prefix, anchor_suffix, type, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'ann-orphan',
          'art-1',
          'non-existent-section',
          0,
          3,
          'foo',
          '',
          'bar',
          'note',
          'orphan annotation',
          now,
          now,
        );
      db.db.pragma('foreign_keys = ON');

      const engine = createEngine();
      const events = await collectEvents(engine, { annotationId: 'ann-orphan' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Section not found: non-existent-section',
      });
    });

    it('should yield error when LLM stream throws', async () => {
      const engine = createEngine({
        streamError: new Error('Network failure'),
      });
      const events = await collectEvents(engine, { annotationId: 'ann-1' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Network failure',
      });
    });

    it('should yield error with unknown message when LLM throws non-Error', async () => {
      const engine = createEngine({
        streamError: 'string error' as unknown as Error,
      });
      const events = await collectEvents(engine, { annotationId: 'ann-1' });

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Unknown error during AI reply generation',
      });
    });

    it('should not save assistant message when stream errors', async () => {
      const engine = createEngine({
        streamError: new Error('API down'),
      });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      expect(messages).toHaveLength(0);
    });

    it('should handle empty stream gracefully', async () => {
      const engine = createEngine({ streamChunks: [] });
      const events = await collectEvents(engine, { annotationId: 'ann-1' });

      // Empty stream: no text events, just done
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'done',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    it('should not save assistant message when stream is empty', async () => {
      const engine = createEngine({ streamChunks: [] });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      // No content generated, so no message saved
      expect(messages).toHaveLength(0);
    });
  });

  // ── 完整生命周期 ──────────────────────────────────────────────────────

  describe('generateReply - full lifecycle', () => {
    it('should support multi-turn conversation', async () => {
      const engine = createEngine();

      // Round 1: initial question
      const events1 = await collectEvents(engine, { annotationId: 'ann-1' });
      expect(events1.some((e) => e.type === 'text')).toBe(true);
      expect(events1.some((e) => e.type === 'done')).toBe(true);

      let messages = await discussionService.listByAnnotation('ann-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');

      // Round 2: follow-up
      const events2 = await collectEvents(engine, {
        annotationId: 'ann-1',
        userMessage: '能举个例子吗？',
      });
      expect(events2.some((e) => e.type === 'text')).toBe(true);
      expect(events2.some((e) => e.type === 'done')).toBe(true);

      messages = await discussionService.listByAnnotation('ann-1');
      expect(messages).toHaveLength(3); // assistant + user + assistant
      expect(messages[0].role).toBe('assistant');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toBe('能举个例子吗？');
      expect(messages[2].role).toBe('assistant');
    });

    it('should use correct model name from LLM provider', async () => {
      const engine = createEngine({ defaultModel: 'deepseek-v4-pro' });

      for await (const _ of engine.generateReply({ annotationId: 'ann-1' })) {
        // consume
      }

      const messages = await discussionService.listByAnnotation('ann-1');
      expect(messages[0].modelId).toBe('deepseek-v4-pro');
    });
  });
});
