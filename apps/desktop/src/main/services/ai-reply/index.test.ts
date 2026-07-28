import { describe, it, expect, vi } from 'vitest';
import { AIReplyService } from './index';
import type { LLMProvider, ChatCompletionChunk } from '@ai-reader/core';

function mockLLM(): LLMProvider {
  return {
    name: 'mock',
    defaultModel: 'mock-model',
    chat: async () => ({
      id: 'mock-id',
      content: 'AI reply',
      model: 'mock-model',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop' as const,
    }),
    chatStream: async function* (): AsyncIterable<ChatCompletionChunk> {
      yield { id: '1', delta: 'AI ', done: false };
      yield { id: '2', delta: 'reply', done: false };
      yield {
        id: '3',
        delta: '',
        done: true,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    validateApiKey: async () => true,
  };
}

describe('AIReplyService', () => {
  it('should generate reply with context', async () => {
    const service = new AIReplyService(mockLLM());
    const chunks: ChatCompletionChunk[] = [];

    for await (const chunk of service.generateReply({
      selectedText: 'Test content',
      paragraphText: 'This is test content here.',
      currentSection: '# Section 1\n\nThis is test content here. More content.',
      question: 'What is this?',
      discussionHistory: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => !c.done && c.delta.length > 0)).toBe(true);
    expect(chunks.some((c) => c.done)).toBe(true);
  });

  it('should build messages with discussion history', async () => {
    const llm = mockLLM();
    const spy = vi.spyOn(llm, 'chatStream');
    const service = new AIReplyService(llm);

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of service.generateReply({
      selectedText: 'Some text',
      paragraphText: 'Full paragraph.',
      currentSection: '# Chapter',
      question: 'Explain this',
      discussionHistory: [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ],
    })) {
      chunks.push(chunk);
    }

    // Verify chatStream was called with messages including history
    expect(spy).toHaveBeenCalledOnce();
    const request = spy.mock.calls[0][0];
    // First message is system, second is user context, then history messages
    expect(request.messages.length).toBeGreaterThanOrEqual(3);
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[1].role).toBe('user');
    // History messages appended after context
    const lastTwo = request.messages.slice(-2);
    expect(lastTwo[0].role).toBe('user');
    expect(lastTwo[0].content).toBe('Previous question');
    expect(lastTwo[1].role).toBe('assistant');
    expect(lastTwo[1].content).toBe('Previous answer');
  });

  it('should include previous and next paragraphs when provided', async () => {
    const llm = mockLLM();
    const spy = vi.spyOn(llm, 'chatStream');
    const service = new AIReplyService(llm);

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of service.generateReply({
      selectedText: 'middle',
      paragraphText: 'Current paragraph.',
      previousParagraph: 'Previous paragraph.',
      nextParagraph: 'Next paragraph.',
      currentSection: '# Chapter',
      question: 'test',
      discussionHistory: [],
    })) {
      chunks.push(chunk);
    }

    const userMessage = spy.mock.calls[0][0].messages[1];
    expect(userMessage.content).toContain('Previous paragraph.');
    expect(userMessage.content).toContain('Next paragraph.');
  });

  it('should omit previous/next paragraphs when not provided', async () => {
    const llm = mockLLM();
    const spy = vi.spyOn(llm, 'chatStream');
    const service = new AIReplyService(llm);

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of service.generateReply({
      selectedText: 'text',
      paragraphText: 'Paragraph.',
      currentSection: '# Chapter',
      question: 'test',
      discussionHistory: [],
    })) {
      chunks.push(chunk);
    }

    const userMessage = spy.mock.calls[0][0].messages[1];
    expect(userMessage.content).not.toContain('上一段落');
    expect(userMessage.content).not.toContain('下一段落');
  });

  it('should propagate LLM errors', async () => {
    const errorLLM: LLMProvider = {
      name: 'error-mock',
      defaultModel: 'mock',
      chat: async () => {
        throw new Error('not used');
      },
      chatStream: async function* () {
        throw new Error('LLM connection failed');
      },
      validateApiKey: async () => false,
    };

    const service = new AIReplyService(errorLLM);

    await expect(async () => {
      for await (const _ of service.generateReply({
        selectedText: 'text',
        paragraphText: 'para',
        currentSection: 'section',
        question: 'q',
        discussionHistory: [],
      })) {
        // consume
      }
    }).rejects.toThrow('LLM connection failed');
  });
});
