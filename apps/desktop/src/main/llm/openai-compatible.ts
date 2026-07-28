/**
 * OpenAI-Compatible LLM Provider
 *
 * 实现 LLMProvider 接口，支持所有 OpenAI API 兼容的服务端点。
 * 包括 OpenAI、Azure OpenAI、DeepSeek、Moonshot、本地 Ollama 等。
 */

import { createLogger } from '@ai-reader/shared';
import type {
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  TokenUsage,
  StreamIterator,
} from '@ai-reader/core';
import { LLMError, LLMErrorCode } from '@ai-reader/core';

const log = createLogger('llm:openai-compatible');

// ── 配置 ──────────────────────────────────────────────────────────────────

/** OpenAI-compatible Provider 配置 */
export interface OpenAICompatibleConfig {
  /** API 基础 URL，如 'https://api.openai.com/v1' */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 默认模型，如 'gpt-4o-mini' */
  defaultModel: string;
  /** 请求超时（毫秒），默认 60000 */
  timeout?: number;
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
}

// ── OpenAI API 响应类型（内部使用）────────────────────────────────────────

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelsResponse {
  data: Array<{ id: string }>;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

/** 将 OpenAI usage 映射为统一 TokenUsage */
function mapUsage(usage: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}): TokenUsage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

/** 将 OpenAI finish_reason 映射为统一类型 */
function mapFinishReason(
  reason: string | null,
): ChatCompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
      return 'tool_calls';
    default:
      return null;
  }
}

/** 将 HTTP 状态码映射为统一错误码 */
function mapHttpError(status: number, body: string): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError(
      LLMErrorCode.AUTH_ERROR,
      `Authentication failed (HTTP ${status}): ${body}`,
    );
  }
  if (status === 429) {
    return new LLMError(
      LLMErrorCode.RATE_LIMIT,
      `Rate limit exceeded (HTTP 429): ${body}`,
    );
  }
  if (status === 404) {
    return new LLMError(
      LLMErrorCode.MODEL_NOT_FOUND,
      `Model not found (HTTP 404): ${body}`,
    );
  }
  return new LLMError(
    LLMErrorCode.UNKNOWN,
    `HTTP ${status}: ${body}`,
  );
}

// ── Provider 实现 ─────────────────────────────────────────────────────────

/**
 * OpenAI-compatible LLM Provider
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务。
 *
 * @example
 * ```ts
 * const provider = new OpenAICompatibleProvider({
 *   baseUrl: 'https://api.openai.com/v1',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   defaultModel: 'gpt-4o-mini',
 * });
 *
 * // 非流式
 * const response = await provider.chat({
 *   messages: [{ role: 'user', content: 'Hello' }],
 * });
 *
 * // 流式
 * for await (const chunk of provider.chatStream({
 *   messages: [{ role: 'user', content: 'Hello' }],
 * })) {
 *   process.stdout.write(chunk.delta);
 * }
 * ```
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';

  private readonly config: Required<OpenAICompatibleConfig>;

  constructor(config: OpenAICompatibleConfig) {
    this.config = {
      timeout: 60_000,
      maxRetries: 2,
      ...config,
    };
    log.info(`Initialized with model=${config.defaultModel}, baseUrl=${config.baseUrl}`);
  }

  get defaultModel(): string {
    return this.config.defaultModel;
  }

  // ── 非流式请求 ────────────────────────────────────────────────────────

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const model = request.model ?? this.config.defaultModel;
    log.debug(`chat() model=${model}, messages=${request.messages.length}`);

    const body = {
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })),
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
      ...(request.topP != null ? { top_p: request.topP } : {}),
      ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop ? { stop: request.stop } : {}),
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      stream: false,
    };

    const raw = await this.requestWithRetry<OpenAIChatResponse>(
      '/chat/completions',
      body,
    );

    const choice = raw.choices[0];
    if (!choice) {
      throw new LLMError(LLMErrorCode.UNKNOWN, 'Empty response: no choices returned');
    }

    return {
      id: raw.id,
      content: choice.message.content ?? '',
      model: raw.model,
      usage: mapUsage(raw.usage),
      finishReason: mapFinishReason(choice.finish_reason),
    };
  }

  // ── 流式请求 ──────────────────────────────────────────────────────────

  async *chatStream(request: ChatCompletionRequest): StreamIterator {
    const model = request.model ?? this.config.defaultModel;
    log.debug(`chatStream() model=${model}, messages=${request.messages.length}`);

    const body = {
      model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      })),
      ...(request.temperature != null ? { temperature: request.temperature } : {}),
      ...(request.topP != null ? { top_p: request.topP } : {}),
      ...(request.maxTokens != null ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop ? { stop: request.stop } : {}),
      stream: true,
    };

    const response = await this.fetchWithAuth('/chat/completions', body);

    if (!response.ok) {
      const errorBody = await response.text();
      throw mapHttpError(response.status, errorBody);
    }

    if (!response.body) {
      throw new LLMError(LLMErrorCode.NETWORK_ERROR, 'Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkId = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield {
              id: chunkId,
              delta: '',
              done: true,
              finishReason: 'stop',
            };
            return;
          }

          try {
            const parsed: OpenAIStreamChunk = JSON.parse(data);
            chunkId = parsed.id;

            const delta = parsed.choices[0]?.delta?.content ?? '';
            const finishReason = parsed.choices[0]?.finish_reason ?? null;

            yield {
              id: parsed.id,
              delta,
              done: false,
              ...(finishReason
                ? {
                    finishReason: mapFinishReason(finishReason),
                    usage: parsed.usage ? mapUsage(parsed.usage) : undefined,
                  }
                : {}),
            };
          } catch {
            log.warn(`Failed to parse SSE chunk: ${data}`);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── 验证 API Key ─────────────────────────────────────────────────────

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await this.fetchWithAuth('/models', undefined, 'GET');
      if (response.ok) {
        log.info('API key validated successfully');
        return true;
      }
      log.warn(`API key validation failed: HTTP ${response.status}`);
      return false;
    } catch (err) {
      log.error('API key validation error', err);
      return false;
    }
  }

  // ── 列出可用模型 ─────────────────────────────────────────────────────

  async listModels(): Promise<string[]> {
    try {
      const response = await this.fetchWithAuth('/models', undefined, 'GET');
      if (!response.ok) {
        log.warn(`listModels failed: HTTP ${response.status}`);
        return [];
      }
      const data: OpenAIModelsResponse = await response.json();
      return data.data.map((m) => m.id);
    } catch (err) {
      log.error('listModels error', err);
      return [];
    }
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────

  /**
   * 带认证和超时的 fetch 封装
   */
  private async fetchWithAuth(
    path: string,
    body?: unknown,
    method = 'POST',
  ): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new LLMError(
          LLMErrorCode.TIMEOUT,
          `Request timed out after ${this.config.timeout}ms`,
          err,
        );
      }
      throw new LLMError(LLMErrorCode.NETWORK_ERROR, `Network error: ${String(err)}`, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 带重试的请求（仅对可重试错误重试）
   */
  private async requestWithRetry<T>(path: string, body: unknown): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
        log.debug(`Retry attempt ${attempt} after ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        const response = await this.fetchWithAuth(path, body);

        if (response.ok) {
          return (await response.json()) as T;
        }

        const errorBody = await response.text();
        const error = mapHttpError(response.status, errorBody);

        // 仅对限流和网络错误重试
        if (
          error.code === LLMErrorCode.RATE_LIMIT ||
          error.code === LLMErrorCode.NETWORK_ERROR
        ) {
          lastError = error;
          continue;
        }

        throw error;
      } catch (err) {
        if (err instanceof LLMError && err.code === LLMErrorCode.TIMEOUT) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw (
      lastError ??
      new LLMError(LLMErrorCode.UNKNOWN, 'Max retries exceeded with no error captured')
    );
  }
}
