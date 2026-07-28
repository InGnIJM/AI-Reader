/**
 * AI Reply Engine Service
 *
 * 为批注生成 AI 回复：
 * - buildContext: 从批注、章节内容、对话历史组装上下文
 * - generateReply: 流式生成 AI 回复并自动保存到讨论消息
 *
 * MVP 阶段覆盖基础上下文（basic）和结构上下文（structural），
 * 语义上下文（向量检索）和记忆上下文（Reading Memory）留待 Phase 2。
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatCompletionRequest,
} from '@ai-reader/core';
import { createLogger } from '@ai-reader/shared';
import type { DatabaseClient } from '../../db/client';
import type { AnnotationService, Annotation } from '../annotation';
import type { DiscussionService, DiscussionMessage } from '../discussion';

const log = createLogger('ai-reply-engine');

// ── 类型定义 ──────────────────────────────────────────────────────────────

/** AI 回复流式事件 */
export type AIReplyStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; error: string };

/** 上下文构建输入 */
export interface ReplyContext {
  /** 批注 ID */
  annotationId: string;
  /** 用户的追问内容（在已有讨论线程中继续对话时） */
  userMessage?: string;
}

/** 内部：从数据库查出的章节信息 */
interface SectionRow {
  id: string;
  title: string;
  content: string;
}

/** 内部：从数据库查出的文章信息 */
interface ArticleRow {
  id: string;
  title: string;
}

// ── 服务实现 ──────────────────────────────────────────────────────────────

/**
 * AI 回复引擎。
 *
 * 职责：
 * 1. 从批注、章节、对话历史中构建 LLM 上下文
 * 2. 调用 LLMProvider 流式生成回复
 * 3. 将回复保存为讨论消息
 *
 * 依赖 LLMProvider 接口，不绑定具体 LLM 实现。
 *
 * @example
 * ```ts
 * const engine = new AIReplyEngine({
 *   llm: llmProvider,
 *   db: dbClient,
 *   annotationService,
 *   discussionService,
 * });
 *
 * for await (const event of engine.generateReply({ annotationId: 'ann-1' })) {
 *   if (event.type === 'text') process.stdout.write(event.content);
 *   if (event.type === 'done') console.log('Tokens:', event.usage);
 * }
 * ```
 */
export class AIReplyEngine {
  private readonly llm: LLMProvider;
  private readonly db: DatabaseClient;
  private readonly annotationService: AnnotationService;
  private readonly discussionService: DiscussionService;

  constructor(deps: {
    llm: LLMProvider;
    db: DatabaseClient;
    annotationService: AnnotationService;
    discussionService: DiscussionService;
  }) {
    this.llm = deps.llm;
    this.db = deps.db;
    this.annotationService = deps.annotationService;
    this.discussionService = deps.discussionService;
  }

  /**
   * 流式生成 AI 回复。
   *
   * 完整流程：
   * 1. 加载批注及其关联的章节/文章信息
   * 2. 加载该批注下的已有对话历史
   * 3. 构建 system prompt + messages
   * 4. 流式调用 LLM
   * 5. 收集完整回复后保存为 assistant 讨论消息
   * 6. 如果有 userMessage，先保存为 user 讨论消息
   *
   * @param context 包含批注 ID 和可选的用户追问
   * @returns 异步迭代器，产生 text / done / error 事件
   */
  async *generateReply(context: ReplyContext): AsyncIterable<AIReplyStreamEvent> {
    const { annotationId, userMessage } = context;

    log.info(`Generating reply for annotation ${annotationId}`);

    // ── 1. 加载批注 ─────────────────────────────────────────────────────
    const annotation = await this.annotationService.getById(annotationId);
    if (!annotation) {
      yield { type: 'error', error: `Annotation not found: ${annotationId}` };
      return;
    }

    // ── 2. 加载章节和文章信息 ──────────────────────────────────────────
    const section = this.getSection(annotation.sectionId);
    if (!section) {
      yield { type: 'error', error: `Section not found: ${annotation.sectionId}` };
      return;
    }

    const article = this.getArticle(annotation.articleId);

    // ── 3. 保存用户消息（如果有追问） ──────────────────────────────────
    if (userMessage) {
      await this.discussionService.addMessage({
        annotationId,
        role: 'user',
        content: userMessage,
      });
    }

    // ── 4. 加载对话历史 ────────────────────────────────────────────────
    const history = await this.discussionService.listByAnnotation(annotationId);

    // ── 5. 构建上下文 ──────────────────────────────────────────────────
    const messages = this.buildMessages(annotation, section, article, history, userMessage);

    // ── 6. 流式调用 LLM ────────────────────────────────────────────────
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const request: ChatCompletionRequest = {
        messages,
        temperature: 0.7,
      };

      for await (const chunk of this.llm.chatStream(request)) {
        if (chunk.done) {
          // 最后一个 chunk 携带 usage
          if (chunk.usage) {
            inputTokens = chunk.usage.promptTokens;
            outputTokens = chunk.usage.completionTokens;
          }
          break;
        }

        if (chunk.delta) {
          fullContent += chunk.delta;
          yield { type: 'text', content: chunk.delta };
        }
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error during AI reply generation';
      log.error(`Reply generation failed: ${message}`);
      yield { type: 'error', error: message };
      return;
    }

    // ── 7. 保存 AI 回复 ────────────────────────────────────────────────
    if (fullContent) {
      await this.discussionService.addMessage({
        annotationId,
        role: 'assistant',
        content: fullContent,
        modelId: this.llm.defaultModel,
        tokenUsage: { input: inputTokens, output: outputTokens },
      });
      log.info(
        `Reply saved for annotation ${annotationId}: ${fullContent.length} chars, ` +
          `${inputTokens}+${outputTokens} tokens`,
      );
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }

  // ── 上下文构建 ──────────────────────────────────────────────────────────

  /**
   * 构建发送给 LLM 的消息列表。
   *
   * 上下文层次（MVP 阶段）：
   * - 基础上下文：批注选中文本、批注内容、章节标题
   * - 结构上下文：章节完整内容、文章标题
   * - 对话历史：该批注下的已有讨论消息
   */
  private buildMessages(
    annotation: Annotation,
    section: SectionRow,
    article: ArticleRow | null,
    history: DiscussionMessage[],
    userMessage?: string,
  ): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(annotation, section, article);
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // 注入对话历史（排除最后一条 user 消息，因为它会作为 user prompt 注入）
    const historyToInject = userMessage ? history.slice(0, -1) : history;
    for (const msg of historyToInject) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }

    // 构建 user prompt
    const userPrompt = this.buildUserPrompt(annotation, userMessage);
    messages.push({ role: 'user', content: userPrompt });

    return messages;
  }

  /**
   * 构建 system prompt，包含文档结构和章节上下文。
   */
  private buildSystemPrompt(
    annotation: Annotation,
    section: SectionRow,
    article: ArticleRow | null,
  ): string {
    const parts: string[] = [
      '你是一个专业的学习助手。用户在阅读一篇 AI 生成的学习导读时，对某段内容创建了批注并希望得到你的解答。',
      '',
      '## 回答要求',
      '- 结合原文上下文回答，引用相关段落时用引号标注',
      '- 如果用户的问题涉及概念解释，先给出简洁定义，再展开说明',
      '- 如果用户提出质疑或不同观点，客观分析双方立场',
      '- 回答使用 Markdown 格式',
      '- 保持简洁，避免过度展开无关内容',
    ];

    // 文章信息
    if (article) {
      parts.push('', '## 文档信息', `- 文章标题：${article.title}`);
    }

    // 章节信息
    parts.push('', '## 当前章节', `- 章节标题：${section.title}`);

    // 章节内容（截断以控制 token 消耗）
    const maxContentLength = 3000;
    const sectionContent =
      section.content.length > maxContentLength
        ? section.content.substring(0, maxContentLength) + '\n\n[... 内容已截断]'
        : section.content;
    parts.push('', '## 章节内容', sectionContent);

    // 批注锚定的原文
    parts.push(
      '',
      '## 用户批注的原文',
      `> ${annotation.anchorExactText}`,
    );

    return parts.join('\n');
  }

  /**
   * 构建 user prompt，包含批注内容和可选的追问。
   */
  private buildUserPrompt(annotation: Annotation, userMessage?: string): string {
    const parts: string[] = [];

    if (annotation.content) {
      parts.push(`我的批注：${annotation.content}`);
    }

    if (userMessage) {
      parts.push(`我的追问：${userMessage}`);
    }

    // 如果既没有批注内容也没有追问，使用默认提示
    if (parts.length === 0) {
      parts.push(`请解释一下这段内容：「${annotation.anchorExactText}」`);
    }

    return parts.join('\n\n');
  }

  // ── 数据库查询 ──────────────────────────────────────────────────────────

  /**
   * 从数据库查询章节信息。
   */
  private getSection(sectionId: string): SectionRow | null {
    const row = this.db.db
      .prepare(
        `SELECT id, title, content FROM generated_sections WHERE id = ?`,
      )
      .get(sectionId) as SectionRow | undefined;

    return row || null;
  }

  /**
   * 从数据库查询文章信息。
   */
  private getArticle(articleId: string): ArticleRow | null {
    const row = this.db.db
      .prepare(
        `SELECT id, title FROM generated_articles WHERE id = ?`,
      )
      .get(articleId) as ArticleRow | undefined;

    return row || null;
  }
}
