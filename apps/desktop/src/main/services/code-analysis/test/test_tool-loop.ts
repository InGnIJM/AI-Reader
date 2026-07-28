import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider } from '@ai-reader/core';
import { describe, expect, it, vi } from 'vitest';
import { runCodeAnalysisToolLoop } from '../tool-loop';

class MockToolCallingLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  private calls = 0;

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls += 1;
    const content = request.messages.map((message) => message.content).join('\n');

    if (this.calls === 1) {
      return this.response(JSON.stringify({ tool: 'listFiles', args: { path: '.', depth: 2 } }));
    }
    if (this.calls === 2) {
      expect(content).toContain('package.json');
      return this.response('# Startup Flow\n\nEvidence: `package.json`.');
    }
    return this.response('# Done');
  }

  chatStream(): AsyncIterable<any> {
    throw new Error('not used');
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }

  private response(content: string): ChatCompletionResponse {
    return {
      id: `resp-${this.calls}`,
      content,
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }
}

describe('runCodeAnalysisToolLoop', () => {
  it('executes requested tools and returns final Markdown', async () => {
    const executeTool = vi.fn(async () => ({ toolName: 'listFiles' as const, content: 'package.json' }));

    const result = await runCodeAnalysisToolLoop({
      llm: new MockToolCallingLLM(),
      messages: [{ role: 'user', content: 'Analyze startup' }],
      executeTool,
      maxToolCalls: 15,
    });

    expect(executeTool).toHaveBeenCalledWith('listFiles', { path: '.', depth: 2 });
    expect(result.markdown).toContain('# Startup Flow');
    expect(result.traces).toHaveLength(1);
  });

  it('stops when tool call budget is exhausted', async () => {
    class AlwaysToolLLM extends MockToolCallingLLM {
      async chat(): Promise<ChatCompletionResponse> {
        return {
          id: 'tool',
          content: JSON.stringify({ tool: 'searchText', args: { query: 'x' } }),
          model: this.defaultModel,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }
    }

    const result = await runCodeAnalysisToolLoop({
      llm: new AlwaysToolLLM(),
      messages: [{ role: 'user', content: 'Analyze' }],
      executeTool: async () => ({ toolName: 'searchText', content: 'x' }),
      maxToolCalls: 2,
    });

    expect(result.traces).toHaveLength(2);
    expect(result.markdown).toContain('Tool call budget exhausted');
  });
});
