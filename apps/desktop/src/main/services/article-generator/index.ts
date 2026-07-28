/**
 * Article Generator Service
 *
 * 使用 LLM 为导入的文档生成学习导读：
 * - generateOutline: 非流式，生成大纲 JSON
 * - generateSection: 流式，逐 chunk 生成章节内容
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatCompletionRequest,
} from '@ai-reader/core';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('article-generator');

// ── 类型定义 ──────────────────────────────────────────────────────────────

/** 大纲中的一个章节 */
export interface OutlineSection {
  title: string;
  sourceChapterIds: string[];
}

/** 完整大纲 */
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

/** 输入章节信息（来自数据库） */
export interface ChapterInput {
  id: string;
  title: string;
  content: string;
}

/** generateSection 的流式事件 */
export type SectionStreamEvent =
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

// ── 服务实现 ──────────────────────────────────────────────────────────────

/**
 * 文章生成器。
 *
 * 依赖 LLMProvider 接口，不绑定具体 LLM 实现。
 *
 * @example
 * ```ts
 * const generator = new ArticleGenerator(llmProvider);
 *
 * // 生成大纲
 * const outline = await generator.generateOutline('doc-1', chapters);
 *
 * // 流式生成章节
 * for await (const event of generator.generateSection(outline.sections[0].title, sourceChapters)) {
 *   if (event.type === 'text') process.stdout.write(event.content);
 * }
 * ```
 */
export class ArticleGenerator {
  constructor(private readonly llm: LLMProvider) {}

  /**
   * 生成学习导读大纲。
   *
   * 将文档章节摘要发送给 LLM，要求返回 JSON 格式的大纲。
   * 章节内容超过 500 字符时截断以节省 token。
   *
   * @param documentId 文档 ID（仅用于日志）
   * @param chapters   文档的章节列表
   * @returns 解析后的 Outline 对象
   * @throws LLM 返回的 JSON 无法解析或缺少必要字段时抛出错误
   */
  async generateOutline(
    documentId: string,
    chapters: ChapterInput[],
  ): Promise<Outline> {
    log.info(`Generating outline for document ${documentId}`);

    const chaptersSummary = chapters
      .map((ch) => {
        const preview =
          ch.content.length > 500
            ? ch.content.substring(0, 500) + '...'
            : ch.content;
        return `## ${ch.title}\n${preview}`;
      })
      .join('\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个学习助手。请根据以下文档内容生成一个学习导读大纲。

要求：
1. 大纲应该覆盖文档的主要内容
2. 每个章节标题应该清晰描述学习目标
3. 返回 JSON 格式：{ "title": "...", "sections": [{ "title": "...", "sourceChapterIds": ["..."] }] }`,
      },
      {
        role: 'user',
        content: `请为以下文档生成学习导读大纲：\n\n${chaptersSummary}`,
      },
    ];

    const request: ChatCompletionRequest = {
      messages,
      temperature: 0.7,
    };

    const response = await this.llm.chat(request);
    log.debug(`Outline LLM response length: ${response.content.length}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      throw new Error('Failed to parse outline JSON from LLM response');
    }

    // Validate outline structure
    if (!this.isValidOutline(parsed)) {
      throw new Error('Invalid outline format: missing title or sections');
    }

    log.info(
      `Outline generated: ${parsed.title}, ${parsed.sections.length} sections`,
    );
    return parsed as Outline;
  }

  /**
   * 流式生成单个章节的学习导读内容。
   *
   * 将源章节的完整内容发送给 LLM，以 AsyncIterable 方式逐 chunk 返回。
   *
   * @param sectionTitle  章节标题
   * @param sourceChapters 该章节对应的源文档章节
   * @param signal        可选的 AbortSignal（预留，当前 LLMProvider 接口未支持）
   * @returns 异步迭代器，产生 text / done / error 事件
   */
  async *generateSection(
    sectionTitle: string,
    sourceChapters: ChapterInput[],
    signal?: AbortSignal,
  ): AsyncIterable<SectionStreamEvent> {
    log.info(`Generating section: ${sectionTitle}`);

    if (signal?.aborted) {
      yield { type: 'error', error: 'Aborted before generation started' };
      return;
    }

    const sourceContent = sourceChapters
      .map((ch) => `### ${ch.title}\n${ch.content}`)
      .join('\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个学习助手。请根据以下原始内容，生成"${sectionTitle}"章节的学习导读。

要求：
- 包含章节目标
- 核心概念解释
- 原理讲解
- 示例
- 容易混淆的内容
- 本章小结
- 思考题

请使用 Markdown 格式。`,
      },
      {
        role: 'user',
        content: sourceContent,
      },
    ];

    const request: ChatCompletionRequest = {
      messages,
      temperature: 0.7,
    };

    try {
      for await (const chunk of this.llm.chatStream(request)) {
        // Check abort between chunks
        if (signal?.aborted) {
          yield { type: 'error', error: 'Generation aborted' };
          return;
        }

        if (chunk.done) {
          yield { type: 'done' };
          return;
        }

        if (chunk.delta) {
          yield { type: 'text', content: chunk.delta };
        }
      }

      // Stream ended without explicit done chunk
      yield { type: 'done' };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error during streaming';
      log.error(`Section generation failed: ${message}`);
      yield { type: 'error', error: message };
    }
  }

  /**
   * 验证 LLM 返回的 JSON 是否符合 Outline 结构。
   */
  private isValidOutline(data: unknown): data is Outline {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.title !== 'string') return false;
    if (!Array.isArray(obj.sections)) return false;

    return obj.sections.every(
      (s: unknown) =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as Record<string, unknown>).title === 'string' &&
        Array.isArray((s as Record<string, unknown>).sourceChapterIds),
    );
  }
}
