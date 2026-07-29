import type { ChatMessage, LLMProvider } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

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
  outputLanguage?: AppLanguage;
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

function isToolName(value: unknown): value is CodeAnalysisToolName {
  return value === 'listFiles' || value === 'readFile' || value === 'searchText';
}

function toToolRequest(value: unknown): ToolRequest | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<ToolRequest>;
  if (!isToolName(candidate.tool) || typeof candidate.args !== 'object' || candidate.args === null) {
    return null;
  }

  return { tool: candidate.tool, args: candidate.args };
}

function parseJsonToolRequests(content: string): ToolRequest[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    return candidates.map(toToolRequest).filter((request): request is ToolRequest => request !== null);
  } catch {
    return [];
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseXmlToolRequests(content: string): ToolRequest[] {
  const requests: ToolRequest[] = [];
  const toolCallPattern = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;

  for (const toolCallMatch of content.matchAll(toolCallPattern)) {
    const body = toolCallMatch[1];
    const functionMatch =
      body.match(/<function\s*=\s*["']?([A-Za-z][\w-]*)["']?\s*>/i) ??
      body.match(/<function\b[^>]*\bname\s*=\s*["']?([^"'\s>]+)["']?[^>]*>/i);
    const tool = functionMatch?.[1];
    if (!isToolName(tool)) continue;

    const args: Record<string, unknown> = {};
    const parameterPattern =
      /<parameter\s*=\s*["']?([A-Za-z][\w-]*)["']?\s*>([\s\S]*?)<\/parameter>/gi;
    for (const parameterMatch of body.matchAll(parameterPattern)) {
      const name = parameterMatch[1];
      args[name] = decodeXmlEntities(parameterMatch[2].trim());
    }

    requests.push({ tool, args });
  }

  return requests;
}

export function parseToolRequests(content: string): ToolRequest[] {
  const jsonRequests = parseJsonToolRequests(content);
  return jsonRequests.length > 0 ? jsonRequests : parseXmlToolRequests(content);
}

function stripToolCallMarkup(content: string): string {
  return content.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '').trim();
}

export async function runCodeAnalysisToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
  const messages = [...input.messages];
  const traces: ToolLoopTrace[] = [];

  while (true) {
    const response = await input.llm.chat({ messages, temperature: 0.2 });
    const toolRequests = parseToolRequests(response.content);

    if (toolRequests.length === 0) {
      const markdown = stripToolCallMarkup(response.content);
      return {
        markdown:
          markdown ||
          (input.outputLanguage === 'zh-CN'
            ? '# 分析未完成\n\n模型返回了不支持的工具调用，且没有给出最终答案。'
            : '# Analysis Incomplete\n\nThe model returned an unsupported tool call without a final answer.'),
        traces,
        modelId: response.model,
      };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolResults: string[] = [];

    for (const toolRequest of toolRequests) {
      if (traces.length >= input.maxToolCalls) {
        return {
          markdown:
            input.outputLanguage === 'zh-CN'
              ? [
                  '# 分析未完成',
                  '',
                  '模型生成最终答案前已用完工具调用次数。',
                  '请缩小分析目标后重试。',
                ].join('\n')
              : [
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
      toolResults.push(`Tool result for ${toolRequest.tool}:\n${resultSummary}`);
    }

    messages.push({
      role: 'user',
      content: [
        ...toolResults,
        '',
        'Continue analysis. Request another tool as JSON or return final Markdown.',
      ].join('\n'),
    });
  }
}
