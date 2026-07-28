/**
 * LLM Provider Interface
 *
 * 定义与大语言模型交互的统一抽象层。
 * 所有 LLM 提供商（OpenAI、Claude、本地模型等）都应实现此接口。
 */

// ── 消息类型 ──────────────────────────────────────────────────────────────

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 聊天消息 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  /** 可选的名称标识，用于区分同一角色的不同参与者 */
  name?: string;
}

// ── 请求参数 ──────────────────────────────────────────────────────────────

/** 聊天补全请求参数 */
export interface ChatCompletionRequest {
  /** 消息列表 */
  messages: ChatMessage[];
  /** 模型标识，不传则使用 provider 默认模型 */
  model?: string;
  /** 采样温度 (0-2)，越高越随机 */
  temperature?: number;
  /** 核采样阈值 (0-1) */
  topP?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
  /** 是否流式输出 */
  stream?: boolean;
  /** 停止序列 */
  stop?: string[];
  /** JSON Schema 约束输出格式 */
  responseFormat?: ResponseFormat;
}

/** 响应格式约束 */
export interface ResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: Record<string, unknown>;
  };
}

// ── 响应类型 ──────────────────────────────────────────────────────────────

/** Token 用量统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 聊天补全响应 */
export interface ChatCompletionResponse {
  /** 响应 ID */
  id: string;
  /** 生成的文本内容 */
  content: string;
  /** 模型标识 */
  model: string;
  /** Token 用量 */
  usage: TokenUsage;
  /** 完成原因 */
  finishReason: 'stop' | 'length' | 'content_filter' | 'tool_calls' | null;
}

/** 流式响应 chunk */
export interface ChatCompletionChunk {
  /** chunk ID */
  id: string;
  /** 本次 chunk 的增量文本 */
  delta: string;
  /** 是否为最后一个 chunk */
  done: boolean;
  /** 仅在最后一个 chunk 中携带 */
  usage?: TokenUsage;
  /** 完成原因，仅在最后一个 chunk 中携带 */
  finishReason?: ChatCompletionResponse['finishReason'];
}

// ── 错误类型 ──────────────────────────────────────────────────────────────

/** LLM Provider 错误码 */
export enum LLMErrorCode {
  /** API Key 无效或缺失 */
  AUTH_ERROR = 'AUTH_ERROR',
  /** 请求频率超限 */
  RATE_LIMIT = 'RATE_LIMIT',
  /** 上下文长度超限 */
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  /** 模型不存在或不可用 */
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  /** 内容被安全过滤器拦截 */
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  /** 网络连接失败 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 请求超时 */
  TIMEOUT = 'TIMEOUT',
  /** 其他未知错误 */
  UNKNOWN = 'UNKNOWN',
}

/** LLM Provider 统一错误 */
export class LLMError extends Error {
  constructor(
    public readonly code: LLMErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// ── Provider 接口 ──────────────────────────────────────────────────────────

/** 流式响应的异步迭代器类型 */
export type StreamIterator = AsyncIterable<ChatCompletionChunk>;

/**
 * LLM Provider 统一接口
 *
 * 职责：
 * 1. 屏蔽不同 LLM API 的差异，提供统一的调用方式
 * 2. 处理认证、重试、错误映射
 * 3. 支持同步请求和流式请求
 */
export interface LLMProvider {
  /** Provider 名称（如 'openai', 'anthropic', 'ollama'） */
  readonly name: string;

  /** 当前使用的默认模型标识 */
  readonly defaultModel: string;

  /**
   * 发起聊天补全请求（非流式）
   *
   * @param request 请求参数
   * @returns 补全响应
   * @throws LLMError 认证失败、限流、超时等
   */
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * 发起聊天补全请求（流式）
   *
   * @param request 请求参数（stream 字段会被强制设为 true）
   * @returns 异步迭代器，逐 chunk 返回结果
   * @throws LLMError 认证失败、限流、超时等
   */
  chatStream(request: ChatCompletionRequest): StreamIterator;

  /**
   * 验证 API Key 是否有效
   *
   * @returns true 表示有效，false 表示无效
   */
  validateApiKey(): Promise<boolean>;

  /**
   * 列出可用模型（可选实现）
   *
   * @returns 模型标识列表，不支持时返回空数组
   */
  listModels?(): Promise<string[]>;
}
