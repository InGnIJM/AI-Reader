import type { DatabaseClient } from '../../db/client';
import { createLogger } from '@ai-reader/shared';
import { randomUUID } from 'crypto';

const log = createLogger('discussion');

// ── 类型定义 ──────────────────────────────────────────────────────────────

/** 讨论消息角色 */
export type MessageRole = 'user' | 'assistant';

/** 添加消息参数 */
export interface AddMessageParams {
  annotationId: string;
  role: MessageRole;
  content: string;
  modelId?: string;
  tokenUsage?: { input: number; output: number };
}

/** 讨论消息对象 */
export interface DiscussionMessage {
  id: string;
  annotationId: string;
  role: string;
  content: string;
  modelId?: string;
  tokenUsage?: string;
  createdAt: string;
}

// ── 服务实现 ──────────────────────────────────────────────────────────────

/**
 * 讨论服务。
 *
 * 管理批注下的讨论消息（用户提问、AI 回复），支持添加消息、按批注查询。
 * 消息按创建时间升序排列，形成对话历史。
 */
export class DiscussionService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * 添加一条讨论消息。
   *
   * @param params 添加参数（批注 ID、角色、内容等）
   * @returns 创建的消息对象
   * @throws 批注不存在时数据库会抛出外键约束错误
   */
  async addMessage(params: AddMessageParams): Promise<DiscussionMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tokenUsageStr = params.tokenUsage
      ? JSON.stringify(params.tokenUsage)
      : null;

    this.db.db
      .prepare(
        `INSERT INTO discussion_messages
           (id, annotation_id, role, content, model_id, token_usage, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.annotationId,
        params.role,
        params.content,
        params.modelId || null,
        tokenUsageStr,
        now,
      );

    log.info(
      `Message added to annotation ${params.annotationId}: role=${params.role}`,
    );

    return {
      id,
      annotationId: params.annotationId,
      role: params.role,
      content: params.content,
      modelId: params.modelId,
      tokenUsage: tokenUsageStr || undefined,
      createdAt: now,
    };
  }

  /**
   * 根据 ID 获取单条消息。
   *
   * @param id 消息 ID
   * @returns 消息对象，不存在时返回 null
   */
  async getById(id: string): Promise<DiscussionMessage | null> {
    const row = this.db.db
      .prepare(
        `SELECT id, annotation_id AS annotationId,
                role, content,
                model_id AS modelId,
                token_usage AS tokenUsage,
                created_at AS createdAt
         FROM discussion_messages WHERE id = ?`,
      )
      .get(id) as DiscussionMessage | undefined;

    return row || null;
  }

  /**
   * 获取指定批注的所有讨论消息，按创建时间升序排列。
   *
   * @param annotationId 批注 ID
   * @returns 消息列表
   */
  async listByAnnotation(annotationId: string): Promise<DiscussionMessage[]> {
    return this.db.db
      .prepare(
        `SELECT id, annotation_id AS annotationId,
                role, content,
                model_id AS modelId,
                token_usage AS tokenUsage,
                created_at AS createdAt
         FROM discussion_messages
         WHERE annotation_id = ?
         ORDER BY created_at ASC`,
      )
      .all(annotationId) as DiscussionMessage[];
  }

  /**
   * 删除指定批注下的所有讨论消息。
   *
   * @param annotationId 批注 ID
   */
  async deleteByAnnotation(annotationId: string): Promise<void> {
    this.db.db
      .prepare('DELETE FROM discussion_messages WHERE annotation_id = ?')
      .run(annotationId);
    log.info(`All messages deleted for annotation ${annotationId}`);
  }
}
