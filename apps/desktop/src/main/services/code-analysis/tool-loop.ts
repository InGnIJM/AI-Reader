import type { ChatMessage, LLMProvider } from '@ai-reader/core';

import { summarizeToolResult } from './context-builder';
import type { CodeAnalysisToolName, ToolResult } from './tool-registry';

export interface ToolLoopTrace {
  stepIndex: number;
  toolName: CodeAnalysisToolName;
  toolArgs: Record<string, unknown>;
  resultSummary: string;
}

export interface RunToolLoopInput {
  llm: LLMProvider;
  messages: ChatMessage[];
  executeTool: (name: CodeAnalysisToolName, args: Record<string, unknown>) => Promise<ToolResult>;
  maxToolCalls: number;
}

export interface RunToolLoopResult {
  markdown: string;
  traces: ToolLoopTrace[];
  modelId: string;
}

interface ToolRequest {
  tool: CodeAnalysisToolName;
  args: Record<string, unknown>;
}

function parseToolRequest(content: string): ToolRequest | null {
  try {
    const parsed = JSON.parse(content) as Partial<ToolRequest>;
    if (
      parsed &&
      (parsed.tool === 'listFiles' || parsed.tool === 'readFile' || parsed.tool === 'searchText') &&
      typeof parsed.args === 'object' &&
      parsed.args !== null
    ) {
      return { tool: parsed.tool, args: parsed.args };
    }
    return null;
  } catch {
    return null;
  }
}

export async function runCodeAnalysisToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
  const messages = [...input.messages];
  const traces: ToolLoopTrace[] = [];

  for (let step = 0; step <= input.maxToolCalls; step += 1) {
    const response = await input.llm.chat({ messages, temperature: 0.2 });
    const toolRequest = parseToolRequest(response.content);

    if (!toolRequest) {
      return { markdown: response.content, traces, modelId: response.model };
    }

    if (traces.length >= input.maxToolCalls) {
      return {
        markdown: [
          '# Analysis Incomplete',
          '',
          'Tool call budget exhausted before the model produced a final answer.',
          'Please rerun with a narrower goal or a larger budget.',
        ].join('\n'),
        traces,
        modelId: response.model,
      };
    }

    const toolResult = await input.executeTool(toolRequest.tool, toolRequest.args);
    const resultSummary = summarizeToolResult(toolResult.content, 4000);
    traces.push({
      stepIndex: traces.length,
      toolName: toolRequest.tool,
      toolArgs: toolRequest.args,
      resultSummary,
    });

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        `Tool result for ${toolRequest.tool}:`,
        resultSummary,
        '',
        'Continue analysis. Request another tool as JSON or return final Markdown.',
      ].join('\n'),
    });
  }

  return {
    markdown: '# Analysis Incomplete\n\nTool loop ended without a final Markdown answer.',
    traces,
    modelId: input.llm.defaultModel,
  };
}
