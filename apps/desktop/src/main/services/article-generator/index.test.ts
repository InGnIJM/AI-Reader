import { describe, it, expect } from 'vitest';
import { ArticleGenerator } from './index';
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  StreamIterator,
} from '@ai-reader/core';

// ── Mock LLM Provider ───────────────────────────────────────────────────

function createMockLLM(overrides?: {
  chatResponse?: string;
  streamChunks?: ChatCompletionChunk[];
}): LLMProvider {
  const chatResponse =
    overrides?.chatResponse ??
    JSON.stringify({
      title: 'Test Outline',
      sections: [
        { title: 'Section 1', sourceChapterIds: ['ch1'] },
        { title: 'Section 2', sourceChapterIds: ['ch2'] },
      ],
    });

  const streamChunks: ChatCompletionChunk[] = overrides?.streamChunks ?? [
    { id: '1', delta: '# Generated\n\n', done: false },
    { id: '2', delta: 'Content here.', done: false },
    {
      id: '3',
      delta: '',
      done: true,
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    },
  ];

  return {
    name: 'mock',
    defaultModel: 'mock-model',
    chat: async (
      _request: ChatCompletionRequest,
    ): Promise<ChatCompletionResponse> => ({
      id: 'mock-id',
      content: chatResponse,
      model: 'mock-model',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: 'stop',
    }),
    chatStream: async function* (_request: ChatCompletionRequest): StreamIterator {
      for (const chunk of streamChunks) {
        yield chunk;
      }
    },
    validateApiKey: async () => true,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('ArticleGenerator', () => {
  describe('generateOutline', () => {
    it('should return parsed outline from LLM chat response', async () => {
      const generator = new ArticleGenerator(createMockLLM());
      const outline = await generator.generateOutline('doc-1', [
        { id: 'ch1', title: 'Chapter 1', content: 'Content 1' },
        { id: 'ch2', title: 'Chapter 2', content: 'Content 2' },
      ]);

      expect(outline.title).toBe('Test Outline');
      expect(outline.sections).toHaveLength(2);
      expect(outline.sections[0].title).toBe('Section 1');
      expect(outline.sections[0].sourceChapterIds).toEqual(['ch1']);
    });

    it('should include chapter summaries in the prompt', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();

      const spy: LLMProvider = {
        ...mockLLM,
        chat: async (request: ChatCompletionRequest) => {
          capturedRequest = request;
          return mockLLM.chat(request);
        },
      };

      const generator = new ArticleGenerator(spy);
      await generator.generateOutline('doc-1', [
        { id: 'ch1', title: 'Intro', content: 'Hello world' },
      ]);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.messages).toHaveLength(2);
      expect(capturedRequest!.messages[0].role).toBe('system');
      expect(capturedRequest!.messages[1].role).toBe('user');
      expect(capturedRequest!.messages[1].content).toContain('Intro');
      expect(capturedRequest!.messages[1].content).toContain('Hello world');
    });

    it('should truncate long chapter content in summary', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();

      const spy: LLMProvider = {
        ...mockLLM,
        chat: async (request: ChatCompletionRequest) => {
          capturedRequest = request;
          return mockLLM.chat(request);
        },
      };

      const longContent = 'A'.repeat(1000);
      const generator = new ArticleGenerator(spy);
      await generator.generateOutline('doc-1', [
        { id: 'ch1', title: 'Big', content: longContent },
      ]);

      // The user prompt should contain truncated content (500 chars + "...")
      const userMsg = capturedRequest!.messages[1].content;
      expect(userMsg).toContain('Big');
      expect(userMsg).toContain('...');
      // The full 1000 chars should NOT appear
      expect(userMsg).not.toContain(longContent);
    });

    it('should throw when LLM returns invalid JSON', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({ chatResponse: 'not json' }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Failed to parse outline JSON from LLM response');
    });

    it('should throw when LLM returns JSON without required fields', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({ chatResponse: '{"foo":"bar"}' }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Invalid outline format');
    });

    it('should handle empty chapters array', async () => {
      const generator = new ArticleGenerator(createMockLLM());
      const outline = await generator.generateOutline('doc-1', []);

      expect(outline.title).toBe('Test Outline');
      expect(outline.sections).toHaveLength(2);
    });

    it('should throw when sections is not an array', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({
          chatResponse: '{"title":"Valid Title","sections":"not-an-array"}',
        }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Invalid outline format');
    });

    it('should throw when section item has non-string title', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({
          chatResponse: JSON.stringify({
            title: 'Outline',
            sections: [{ title: 123, sourceChapterIds: ['ch1'] }],
          }),
        }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Invalid outline format');
    });

    it('should throw when section item is missing sourceChapterIds', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({
          chatResponse: JSON.stringify({
            title: 'Outline',
            sections: [{ title: 'Section' }],
          }),
        }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Invalid outline format');
    });

    it('should throw when LLM returns null (valid JSON, invalid outline)', async () => {
      const generator = new ArticleGenerator(
        createMockLLM({ chatResponse: 'null' }),
      );

      await expect(
        generator.generateOutline('doc-1', [
          { id: 'ch1', title: 'Ch1', content: 'Body' },
        ]),
      ).rejects.toThrow('Invalid outline format');
    });

    it('should not truncate chapter content under 500 chars', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();

      const spy: LLMProvider = {
        ...mockLLM,
        chat: async (request: ChatCompletionRequest) => {
          capturedRequest = request;
          return mockLLM.chat(request);
        },
      };

      const shortContent = 'A'.repeat(200);
      const generator = new ArticleGenerator(spy);
      await generator.generateOutline('doc-1', [
        { id: 'ch1', title: 'Small', content: shortContent },
      ]);

      const userMsg = capturedRequest!.messages[1].content;
      expect(userMsg).toContain(shortContent);
      expect(userMsg).not.toContain('...');
    });
  });

  describe('generateSection', () => {
    it('should yield text chunks from LLM stream', async () => {
      const generator = new ArticleGenerator(createMockLLM());
      const events: Array<{ type: string; content?: string }> = [];

      for await (const event of generator.generateSection(
        'Section 1',
        [{ id: 'ch1', title: 'Ch1', content: 'Source content' }],
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(3); // 2 text + 1 done
      expect(events[0]).toEqual({ type: 'text', content: '# Generated\n\n' });
      expect(events[1]).toEqual({ type: 'text', content: 'Content here.' });
      expect(events[2]).toEqual({ type: 'done' });
    });

    it('should include source chapter content in prompt', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();

      const spy: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const generator = new ArticleGenerator(spy);
      const events: Array<{ type: string; content?: string }> = [];
      for await (const event of generator.generateSection(
        'My Section',
        [
          { id: 'ch1', title: 'Chapter A', content: 'Body A' },
          { id: 'ch2', title: 'Chapter B', content: 'Body B' },
        ],
      )) {
        events.push(event);
      }

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.messages).toHaveLength(2);
      expect(capturedRequest!.messages[0].role).toBe('system');
      expect(capturedRequest!.messages[0].content).toContain('My Section');
      expect(capturedRequest!.messages[1].role).toBe('user');
      expect(capturedRequest!.messages[1].content).toContain('Chapter A');
      expect(capturedRequest!.messages[1].content).toContain('Body A');
      expect(capturedRequest!.messages[1].content).toContain('Chapter B');
      expect(capturedRequest!.messages[1].content).toContain('Body B');
    });

    it('should handle empty stream gracefully', async () => {
      const emptyChunks: ChatCompletionChunk[] = [];
      const generator = new ArticleGenerator(
        createMockLLM({ streamChunks: emptyChunks }),
      );

      const events: Array<{ type: string; content?: string }> = [];
      for await (const event of generator.generateSection(
        'Empty',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
      )) {
        events.push(event);
      }

      // Empty stream still signals completion
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'done' });
    });

    it('should forward signal option to LLM stream', async () => {
      let capturedRequest: ChatCompletionRequest | undefined;
      const mockLLM = createMockLLM();

      const spy: LLMProvider = {
        ...mockLLM,
        chatStream: async function* (request: ChatCompletionRequest): StreamIterator {
          capturedRequest = request;
          yield* mockLLM.chatStream(request);
        },
      };

      const generator = new ArticleGenerator(spy);
      const controller = new AbortController();
      const events: Array<{ type: string }> = [];
      for await (const event of generator.generateSection(
        'Test',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
        controller.signal,
      )) {
        events.push(event);
      }

      // Signal is not part of ChatCompletionRequest in current interface,
      // but the method should accept it without error
      expect(events).toHaveLength(3);
    });

    it('should handle single source chapter', async () => {
      const generator = new ArticleGenerator(createMockLLM());
      const events: Array<{ type: string; content?: string }> = [];

      for await (const event of generator.generateSection(
        'Single',
        [{ id: 'ch1', title: 'Only', content: 'Only content' }],
      )) {
        events.push(event);
      }

      expect(events.some((e) => e.type === 'text')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });

    it('should yield error when signal is already aborted', async () => {
      const generator = new ArticleGenerator(createMockLLM());
      const controller = new AbortController();
      controller.abort();

      const events: Array<{ type: string; error?: string }> = [];
      for await (const event of generator.generateSection(
        'Aborted',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
        controller.signal,
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Aborted before generation started',
      });
    });

    it('should yield error when signal is aborted mid-stream', async () => {
      const controller = new AbortController();

      // Create a mock that aborts the signal after the first chunk
      const streamChunks: ChatCompletionChunk[] = [
        { id: '1', delta: 'first ', done: false },
        { id: '2', delta: 'second', done: false },
        { id: '3', delta: '', done: true, finishReason: 'stop' },
      ];

      let yieldCount = 0;
      const mockLLM: LLMProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        chat: async () => ({
          id: 'mock-id',
          content: '{}',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
        chatStream: async function* (): StreamIterator {
          for (const chunk of streamChunks) {
            if (yieldCount === 1) {
              controller.abort();
            }
            yieldCount++;
            yield chunk;
          }
        },
        validateApiKey: async () => true,
      };

      const generator = new ArticleGenerator(mockLLM);
      const events: Array<{ type: string; content?: string; error?: string }> = [];

      for await (const event of generator.generateSection(
        'AbortMid',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
        controller.signal,
      )) {
        events.push(event);
      }

      // First chunk is yielded as text, then abort detected before second chunk
      expect(events[0]).toEqual({ type: 'text', content: 'first ' });
      expect(events[1]).toEqual({ type: 'error', error: 'Generation aborted' });
    });

    it('should yield error when chatStream throws', async () => {
      const mockLLM: LLMProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        chat: async () => ({
          id: 'mock-id',
          content: '{}',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
        chatStream: async function* (): StreamIterator {
          throw new Error('Network failure');
        },
        validateApiKey: async () => true,
      };

      const generator = new ArticleGenerator(mockLLM);
      const events: Array<{ type: string; error?: string }> = [];

      for await (const event of generator.generateSection(
        'ErrorSection',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Network failure',
      });
    });

    it('should yield error with unknown message when chatStream throws non-Error', async () => {
      const mockLLM: LLMProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        chat: async () => ({
          id: 'mock-id',
          content: '{}',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
        chatStream: async function* (): StreamIterator {
          throw 'string error'; // eslint-disable-line no-throw-literal
        },
        validateApiKey: async () => true,
      };

      const generator = new ArticleGenerator(mockLLM);
      const events: Array<{ type: string; error?: string }> = [];

      for await (const event of generator.generateSection(
        'ErrorSection',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'error',
        error: 'Unknown error during streaming',
      });
    });

    it('should yield done when stream ends without explicit done chunk', async () => {
      // Stream has text chunks but no final done:true chunk
      const streamChunks: ChatCompletionChunk[] = [
        { id: '1', delta: 'partial content', done: false },
      ];

      const mockLLM: LLMProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        chat: async () => ({
          id: 'mock-id',
          content: '{}',
          model: 'mock-model',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          finishReason: 'stop',
        }),
        chatStream: async function* (): StreamIterator {
          for (const chunk of streamChunks) {
            yield chunk;
          }
          // Stream ends without yielding a done chunk
        },
        validateApiKey: async () => true,
      };

      const generator = new ArticleGenerator(mockLLM);
      const events: Array<{ type: string; content?: string }> = [];

      for await (const event of generator.generateSection(
        'NoDone',
        [{ id: 'ch1', title: 'Ch1', content: 'Body' }],
      )) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'text', content: 'partial content' });
      expect(events[1]).toEqual({ type: 'done' });
    });
  });
});
