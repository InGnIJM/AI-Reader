import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider } from '@ai-reader/core';
import { describe, expect, it, vi } from 'vitest';
import { parseToolRequests, runCodeAnalysisToolLoop } from '../tool-loop';
import type { CodeAnalysisToolName } from '../tool-registry';

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

describe('parseToolRequests', () => {
  it('keeps valid JSON requests and rejects malformed or unsafe requests', () => {
    const content = JSON.stringify([
      { tool: 'listFiles', args: { path: '.', depth: 2 } },
      { tool: 'writeFile', args: { path: 'README.md' } },
      { tool: 'readFile', args: null },
      { tool: 'readFile', args: 'README.md' },
      null,
      'invalid',
    ]);

    expect(parseToolRequests(content)).toEqual([
      { tool: 'listFiles', args: { path: '.', depth: 2 } },
    ]);
  });

  it('supports XML name attributes and decodes parameter entities', () => {
    const content = [
      '<tool_call><function name="searchText">',
      '<parameter=query>&lt;App&gt; &quot;ready&quot; &apos;now&apos; &amp; safe</parameter>',
      '<parameter=path>src</parameter>',
      '</function></tool_call>',
      '<tool_call><function=writeFile><parameter=path>README.md</parameter></function></tool_call>',
      '<tool_call><function name="missing"></function></tool_call>',
    ].join('');

    expect(parseToolRequests(content)).toEqual([
      {
        tool: 'searchText',
        args: {
          query: `<App> "ready" 'now' & safe`,
          path: 'src',
        },
      },
    ]);
  });
});

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

  it('executes multiple XML-style tool calls instead of returning them as Markdown', async () => {
    class XmlToolCallingLLM extends MockToolCallingLLM {
      private xmlCalls = 0;

      async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        this.xmlCalls += 1;
        if (this.xmlCalls === 1) {
          return {
            id: 'xml-tools',
            content: [
              '<tool_call> <function=readFile> <parameter=path>README.md</parameter> </function> </tool_call>',
              '<tool_call> <function=readFile> <parameter=path>package.json</parameter> </function> </tool_call>',
              '<tool_call> <function=readFile> <parameter=path>pnpm-workspace.yaml</parameter> </function> </tool_call>',
            ].join(''),
            model: this.defaultModel,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            finishReason: 'stop',
          };
        }

        const context = request.messages.map((message) => message.content).join('\n');
        expect(context).toContain('README.md contents');
        expect(context).toContain('package.json contents');
        expect(context).toContain('pnpm-workspace.yaml contents');
        return {
          id: 'xml-final',
          content: '# Project Overview\n\nAnalysis complete.',
          model: this.defaultModel,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }
    }

    const executeTool = vi.fn(async (_name: CodeAnalysisToolName, args: Record<string, unknown>) => ({
      toolName: 'readFile' as const,
      content: `${String(args.path)} contents`,
    }));

    const result = await runCodeAnalysisToolLoop({
      llm: new XmlToolCallingLLM(),
      messages: [{ role: 'user', content: 'Analyze the project' }],
      executeTool,
      maxToolCalls: 15,
    });

    expect(executeTool).toHaveBeenNthCalledWith(1, 'readFile', { path: 'README.md' });
    expect(executeTool).toHaveBeenNthCalledWith(2, 'readFile', { path: 'package.json' });
    expect(executeTool).toHaveBeenNthCalledWith(3, 'readFile', { path: 'pnpm-workspace.yaml' });
    expect(result.markdown).toBe('# Project Overview\n\nAnalysis complete.');
    expect(result.markdown).not.toContain('<tool_call>');
    expect(result.traces).toHaveLength(3);
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

  it('localizes tool-loop fallback messages for Chinese output', async () => {
    class ChineseFallbackLLM extends MockToolCallingLLM {
      async chat(): Promise<ChatCompletionResponse> {
        return {
          id: 'budget',
          content: JSON.stringify({ tool: 'listFiles', args: { path: '.' } }),
          model: this.defaultModel,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }
    }

    const result = await runCodeAnalysisToolLoop({
      llm: new ChineseFallbackLLM(),
      messages: [],
      executeTool: async () => ({ toolName: 'listFiles', content: 'file.ts' }),
      maxToolCalls: 0,
      outputLanguage: 'zh-CN',
    });

    expect(result.markdown).toContain('分析未完成');
    expect(result.markdown).toContain('工具调用次数');
  });

  it('removes unsupported XML tool markup from the final Markdown', async () => {
    class UnsupportedToolLLM extends MockToolCallingLLM {
      async chat(): Promise<ChatCompletionResponse> {
        return {
          id: 'unsupported-tool',
          content: [
            '# Partial Analysis',
            '',
            'The inspected files use a workspace layout.',
            '<tool_call><function=writeFile><parameter=path>README.md</parameter></function></tool_call>',
          ].join('\n'),
          model: this.defaultModel,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }
    }

    const result = await runCodeAnalysisToolLoop({
      llm: new UnsupportedToolLLM(),
      messages: [{ role: 'user', content: 'Analyze' }],
      executeTool: vi.fn(),
      maxToolCalls: 15,
    });

    expect(result.markdown).toContain('# Partial Analysis');
    expect(result.markdown).not.toContain('<tool_call>');
    expect(result.traces).toHaveLength(0);

    class OnlyUnsupportedToolLLM extends UnsupportedToolLLM {
      async chat(): Promise<ChatCompletionResponse> {
        const response = await super.chat();
        return {
          ...response,
          content:
            '<tool_call><function=writeFile><parameter=path>README.md</parameter></function></tool_call>',
        };
      }
    }

    const emptyResult = await runCodeAnalysisToolLoop({
      llm: new OnlyUnsupportedToolLLM(),
      messages: [{ role: 'user', content: 'Analyze' }],
      executeTool: vi.fn(),
      maxToolCalls: 15,
    });
    expect(emptyResult.markdown).toContain('unsupported tool call');
    expect(emptyResult.markdown).not.toContain('<tool_call>');

    const chineseEmptyResult = await runCodeAnalysisToolLoop({
      llm: new OnlyUnsupportedToolLLM(),
      messages: [{ role: 'user', content: 'Analyze' }],
      executeTool: vi.fn(),
      maxToolCalls: 15,
      outputLanguage: 'zh-CN',
    });
    expect(chineseEmptyResult.markdown).toContain('分析未完成');
  });
});
