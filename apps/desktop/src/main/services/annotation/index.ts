import type { DatabaseClient } from '../../db/client';
import { createLogger } from '@ai-reader/shared';
import { randomUUID } from 'crypto';

const log = createLogger('annotation');

// ── 类型定义 ──────────────────────────────────────────────────────────────

/** 批注类型 */
export type AnnotationType = 'note' | 'question' | 'highlight';

/** 创建批注参数 */
export interface CreateAnnotationParams {
  articleId: string;
  sectionId: string;
  selectedText: string;
  type: AnnotationType;
  content?: string;
}

/** 批注对象 */
export interface Annotation {
  id: string;
  articleId: string;
  sectionId: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  anchorExactText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  type: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

// ── 服务实现 ──────────────────────────────────────────────────────────────

/**
 * 批注服务。
 *
 * 负责批注的创建、查询和删除。
 * 创建时自动计算文本锚点（偏移量、前缀、后缀），用于内容变更后的批注定位。
 */
export class AnnotationService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * 创建新批注。
   *
   * 根据选中文本在章节内容中的位置，自动计算锚点信息：
   * - anchorStartOffset / anchorEndOffset：选中文本在章节内容中的字符偏移
   * - anchorPrefix：匹配位置前最多 50 个字符（用于模糊定位）
   * - anchorSuffix：匹配位置后最多 50 个字符（用于模糊定位）
   *
   * @param params 创建参数
   * @returns 创建的批注对象
   * @throws 章节不存在或选中文本在章节中找不到时抛出异常
   */
  async create(params: CreateAnnotationParams): Promise<Annotation> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // 查询章节内容以计算锚点
    const section = this.db.db
      .prepare('SELECT content FROM generated_sections WHERE id = ?')
      .get(params.sectionId) as { content: string } | undefined;

    if (!section) {
      throw new Error(`Section not found: ${params.sectionId}`);
    }

    const startOffset = section.content.indexOf(params.selectedText);
    if (startOffset === -1) {
      throw new Error('Selected text not found in section content');
    }

    const endOffset = startOffset + params.selectedText.length;
    const prefix = section.content.substring(
      Math.max(0, startOffset - 50),
      startOffset,
    );
    const suffix = section.content.substring(endOffset, endOffset + 50);

    this.db.db
      .prepare(
        `INSERT INTO annotations
           (id, article_id, section_id, anchor_start_offset, anchor_end_offset,
            anchor_exact_text, anchor_prefix, anchor_suffix, type, content,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.articleId,
        params.sectionId,
        startOffset,
        endOffset,
        params.selectedText,
        prefix,
        suffix,
        params.type,
        params.content || null,
        now,
        now,
      );

    log.info(
      `Annotation created: ${id} on section ${params.sectionId}, type=${params.type}`,
    );

    return {
      id,
      articleId: params.articleId,
      sectionId: params.sectionId,
      anchorStartOffset: startOffset,
      anchorEndOffset: endOffset,
      anchorExactText: params.selectedText,
      anchorPrefix: prefix,
      anchorSuffix: suffix,
      type: params.type,
      content: params.content,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 根据 ID 获取批注。
   *
   * @param id 批注 ID
   * @returns 批注对象，不存在时返回 null
   */
  async getById(id: string): Promise<Annotation | null> {
    const row = this.db.db
      .prepare(
        `SELECT id, article_id AS articleId, section_id AS sectionId,
                anchor_start_offset AS anchorStartOffset,
                anchor_end_offset AS anchorEndOffset,
                anchor_exact_text AS anchorExactText,
                anchor_prefix AS anchorPrefix,
                anchor_suffix AS anchorSuffix,
                type, content,
                created_at AS createdAt, updated_at AS updatedAt
         FROM annotations WHERE id = ?`,
      )
      .get(id) as Annotation | undefined;

    return row || null;
  }

  /**
   * 获取指定章节的所有批注，按起始偏移量升序排列。
   *
   * @param sectionId 章节 ID
   * @returns 批注列表
   */
  async listBySection(sectionId: string): Promise<Annotation[]> {
    return this.db.db
      .prepare(
        `SELECT id, article_id AS articleId, section_id AS sectionId,
                anchor_start_offset AS anchorStartOffset,
                anchor_end_offset AS anchorEndOffset,
                anchor_exact_text AS anchorExactText,
                anchor_prefix AS anchorPrefix,
                anchor_suffix AS anchorSuffix,
                type, content,
                created_at AS createdAt, updated_at AS updatedAt
         FROM annotations WHERE section_id = ? ORDER BY anchor_start_offset ASC`,
      )
      .all(sectionId) as Annotation[];
  }

  /**
   * 获取指定文章的所有批注，按创建时间升序排列。
   *
   * @param articleId 文章 ID
   * @returns 批注列表
   */
  async listByArticle(articleId: string): Promise<Annotation[]> {
    return this.db.db
      .prepare(
        `SELECT id, article_id AS articleId, section_id AS sectionId,
                anchor_start_offset AS anchorStartOffset,
                anchor_end_offset AS anchorEndOffset,
                anchor_exact_text AS anchorExactText,
                anchor_prefix AS anchorPrefix,
                anchor_suffix AS anchorSuffix,
                type, content,
                created_at AS createdAt, updated_at AS updatedAt
         FROM annotations WHERE article_id = ? ORDER BY created_at ASC`,
      )
      .all(articleId) as Annotation[];
  }

  /**
   * 删除批注。
   *
   * 删除不存在的 ID 不会抛出异常（SQLite DELETE 无匹配行时为 no-op）。
   *
   * @param id 批注 ID
   */
  async delete(id: string): Promise<void> {
    this.db.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
    log.info(`Annotation deleted: ${id}`);
  }
}
