import { describe, it, expect } from 'vitest';
import { LLMError, LLMErrorCode } from '../llm-provider';
import type {
  LLMProvider,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  TokenUsage,
  StreamIterator,
  MessageRole,
  ResponseFormat,
} from '../llm-provider';

describe('LLMErrorCode', () => {
  it('should define all expected error codes', () => {
    expect(LLMErrorCode.AUTH_ERROR).toBe('AUTH_ERROR');
    expect(LLMErrorCode.RATE_LIMIT).toBe('RATE_LIMIT');
    expect(LLMErrorCode.CONTEXT_LENGTH_EXCEEDED).toBe('CONTEXT_LENGTH_EXCEEDED');
    expect(LLMErrorCode.MODEL_NOT_FOUND).toBe('MODEL_NOT_FOUND');
    expect(LLMErrorCode.CONTENT_FILTERED).toBe('CONTENT_FILTERED');
    expect(LLMErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(LLMErrorCode.TIMEOUT).toBe('TIMEOUT');
    expect(LLMErrorCode.UNKNOWN).toBe('UNKNOWN');
  });
});

describe('LLMError', () => {
  it('should create error with code and message', () => {
    const error = new LLMError(LLMErrorCode.AUTH_ERROR, 'Invalid API key');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.code).toBe(LLMErrorCode.AUTH_ERROR);
    expect(error.message).toBe('Invalid API key');
    expect(error.name).toBe('LLMError');
    expect(error.cause).toBeUndefined();
  });

  it('should preserve cause when provided', () => {
    const originalError = new Error('original');
    const error = new LLMError(LLMErrorCode.NETWORK_ERROR, 'Connection failed', originalError);
    expect(error.cause).toBe(originalError);
  });

  it('should be catchable as Error', () => {
    try {
      throw new LLMError(LLMErrorCode.TIMEOUT, 'Request timed out');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      expect((err as LLMError).code).toBe(LLMErrorCode.TIMEOUT);
    }
  });
});

describe('Type exports', () => {
  it('should allow constructing ChatMessage', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello' };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello');
  });

  it('should allow ChatMessage with optional name', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello', name: 'alice' };
    expect(msg.name).toBe('alice');
  });

  it('should allow constructing ChatCompletionRequest', () => {
    const req: ChatCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
      maxTokens: 100,
    };
    expect(req.messages).toHaveLength(1);
    expect(req.temperature).toBe(0.7);
  });

  it('should allow MessageRole values', () => {
    const roles: MessageRole[] = ['system', 'user', 'assistant', 'tool'];
    expect(roles).toHaveLength(4);
  });

  it('should allow constructing TokenUsage', () => {
    const usage: TokenUsage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    };
    expect(usage.totalTokens).toBe(15);
  });

  it('should allow constructing ChatCompletionResponse', () => {
    const resp: ChatCompletionResponse = {
      id: 'test-id',
      content: 'Hello',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    };
    expect(resp.id).toBe('test-id');
    expect(resp.finishReason).toBe('stop');
  });

  it('should allow null finishReason', () => {
    const resp: ChatCompletionResponse = {
      id: 'test-id',
      content: '',
      model: 'gpt-4o-mini',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: null,
    };
    expect(resp.finishReason).toBeNull();
  });

  it('should allow constructing ChatCompletionChunk', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chunk-1',
      delta: 'Hello',
      done: false,
    };
    expect(chunk.done).toBe(false);
  });

  it('should allow ChatCompletionChunk with optional usage and finishReason', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chunk-final',
      delta: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    };
    expect(chunk.usage?.totalTokens).toBe(15);
    expect(chunk.finishReason).toBe('stop');
  });

  it('should allow ResponseFormat', () => {
    const format: ResponseFormat = {
      type: 'json_schema',
      json_schema: {
        name: 'test_schema',
        schema: { type: 'object', properties: { answer: { type: 'string' } } },
      },
    };
    expect(format.type).toBe('json_schema');
  });

  it('LLMProvider interface should be implementable', () => {
    class TestProvider implements LLMProvider {
      readonly name = 'test';
      readonly defaultModel = 'test-model';
      async chat() {
        return {} as ChatCompletionResponse;
      }
      async *chatStream(): StreamIterator {
        yield {} as ChatCompletionChunk;
      }
      async validateApiKey() {
        return true;
      }
    }

    const provider = new TestProvider();
    expect(provider.name).toBe('test');
  });
});
