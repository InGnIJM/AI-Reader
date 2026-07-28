import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible';
import { LLMError, LLMErrorCode } from '@ai-reader/core';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () =>
      Promise.resolve(
        typeof body === 'string' ? body : JSON.stringify(body),
      ),
    body: null,
  } as unknown as Response;
}

function makeStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const data = chunks.map((c) => encoder.encode(c));
  let index = 0;
  const readable = new ReadableStream({
    pull(controller) {
      if (index < data.length) {
        controller.enqueue(data[index++]);
      } else {
        controller.close();
      }
    },
  });
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    body: readable,
  } as unknown as Response;
}

describe('OpenAICompatibleProvider', () => {
  const config = {
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'test-key',
    defaultModel: 'gpt-4o-mini',
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('constructor', () => {
    it('should set name and defaultModel', () => {
      const provider = new OpenAICompatibleProvider(config);
      expect(provider.name).toBe('openai-compatible');
      expect(provider.defaultModel).toBe('gpt-4o-mini');
    });
  });

  describe('chat()', () => {
    it('should return a successful response', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'chatcmpl-123',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.id).toBe('chatcmpl-123');
      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should use defaultModel when model is not specified', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c1',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({ messages: [{ role: 'user', content: 'test' }] });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
    });

    it('should use request model over defaultModel', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c2',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4o',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o');
    });

    it('should pass temperature, topP, maxTokens, stop to body', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c3',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({
        messages: [{ role: 'user', content: 'test' }],
        temperature: 0.5,
        topP: 0.9,
        maxTokens: 100,
        stop: ['END'],
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.9);
      expect(body.max_tokens).toBe(100);
      expect(body.stop).toEqual(['END']);
    });

    it('should throw LLMError on empty choices', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c-empty',
          model: 'gpt-4o-mini',
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('should throw AUTH_ERROR on 401', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Unauthorized', 401));

      const provider = new OpenAICompatibleProvider(config);
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow(
        expect.objectContaining({ code: LLMErrorCode.AUTH_ERROR }),
      );
    });

    it('should throw RATE_LIMIT on 429 and retry', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse('Rate limited', 429))
        .mockResolvedValueOnce(
          makeResponse({
            id: 'c-retry',
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
        );

      const provider = new OpenAICompatibleProvider(config);
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(result.content).toBe('ok');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 401 (non-retryable)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Unauthorized', 401));

      const provider = new OpenAICompatibleProvider({
        ...config,
        maxRetries: 2,
      });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow(
        expect.objectContaining({ code: LLMErrorCode.AUTH_ERROR }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw NETWORK_ERROR on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      const provider = new OpenAICompatibleProvider(config);
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('should include name field in messages when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({
        messages: [{ role: 'user', content: 'test', name: 'alice' }],
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].name).toBe('alice');
    });
  });

  describe('chatStream()', () => {
    it('should set stream: true in request body', async () => {
      mockFetch.mockResolvedValueOnce(makeStreamResponse(['data: [DONE]\n\n']));

      const provider = new OpenAICompatibleProvider(config);
      for await (const _ of provider.chatStream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // consume
      }
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
    });

    it('should throw LLMError on HTTP error in stream', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Unauthorized', 401));

      const provider = new OpenAICompatibleProvider(config);
      await expect(async () => {
        for await (const _ of provider.chatStream({
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          // consume
        }
      }).rejects.toThrow(
        expect.objectContaining({ code: LLMErrorCode.AUTH_ERROR }),
      );
    });

    it('should yield text chunks from SSE stream', async () => {
      const c1 = JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1000,
        model: 'gpt-4o-mini',
        choices: [
          { index: 0, delta: { content: 'Hello' }, finish_reason: null },
        ],
      });
      const c2 = JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1000,
        model: 'gpt-4o-mini',
        choices: [
          { index: 0, delta: { content: ' world' }, finish_reason: null },
        ],
      });
      const end = JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1000,
        model: 'gpt-4o-mini',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      });
      mockFetch.mockResolvedValueOnce(
        makeStreamResponse([
          'data: ' + c1 + '\n\n',
          'data: ' + c2 + '\n\n',
          'data: ' + end + '\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const provider = new OpenAICompatibleProvider(config);
      const chunks: Array<{ delta: string; done: boolean }> = [];
      for await (const chunk of provider.chatStream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push({ delta: chunk.delta, done: chunk.done });
      }

      expect(chunks[0].delta).toBe('Hello');
      expect(chunks[1].delta).toBe(' world');
      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it('should skip malformed SSE data', async () => {
      const valid = JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 1000,
        model: 'gpt-4o-mini',
        choices: [
          { index: 0, delta: { content: 'OK' }, finish_reason: null },
        ],
      });
      mockFetch.mockResolvedValueOnce(
        makeStreamResponse([
          'data: {invalid json\n\n',
          'data: ' + valid + '\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const provider = new OpenAICompatibleProvider(config);
      const chunks: Array<{ delta: string; done: boolean }> = [];
      for await (const chunk of provider.chatStream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        chunks.push({ delta: chunk.delta, done: chunk.done });
      }

      expect(chunks[0].delta).toBe('OK');
      expect(chunks[chunks.length - 1].done).toBe(true);
    });

    it('should throw NETWORK_ERROR when response body is null', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      const provider = new OpenAICompatibleProvider(config);
      await expect(async () => {
        for await (const _ of provider.chatStream({
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          // consume
        }
      }).rejects.toThrow(LLMError);
    });
  });

  describe('validateApiKey()', () => {
    it('should return true when API key is valid', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ data: [] }));
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.validateApiKey()).toBe(true);
    });

    it('should return false when API key is invalid', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('Unauthorized', 401));
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.validateApiKey()).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fail'));
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.validateApiKey()).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('should return model list on success', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }),
      );
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.listModels!()).toEqual(['gpt-4o', 'gpt-4o-mini']);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse('err', 500));
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.listModels!()).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fail'));
      const provider = new OpenAICompatibleProvider(config);
      expect(await provider.listModels!()).toEqual([]);
    });
  });

  describe('retry behavior', () => {
    it('should retry on timeout', async () => {
      mockFetch
        .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
        .mockResolvedValueOnce(
          makeResponse({
            id: 'c-retry',
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
        );

      const provider = new OpenAICompatibleProvider({
        ...config,
        maxRetries: 1,
      });
      const result = await provider.chat({
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(result.content).toBe('ok');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should give up after maxRetries', async () => {
      mockFetch.mockResolvedValue(makeResponse('Rate limited', 429));

      const provider = new OpenAICompatibleProvider({
        ...config,
        maxRetries: 1,
      });
      await expect(
        provider.chat({ messages: [{ role: 'user', content: 'test' }] }),
      ).rejects.toThrow(
        expect.objectContaining({ code: LLMErrorCode.RATE_LIMIT }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('request headers', () => {
    it('should send Authorization Bearer header', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({ messages: [{ role: 'user', content: 'test' }] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        }),
      );
    });

    it('should use correct baseUrl', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          id: 'c',
          model: 'gpt-4o-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

      const provider = new OpenAICompatibleProvider(config);
      await provider.chat({ messages: [{ role: 'user', content: 'test' }] });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/chat/completions',
        expect.any(Object),
      );
    });
  });
});
