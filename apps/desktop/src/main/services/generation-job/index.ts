import type { DatabaseClient } from '../../db/client';
import { createLogger } from '@ai-reader/shared';
import { randomUUID } from 'crypto';

const log = createLogger('generation-job');

// ── 类型定义 ──────────────────────────────────────────────────────────────

/** 生成任务状态 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 生成任务 */
export interface GenerationJob {
  id: string;
  documentId: string;
  status: JobStatus;
  totalSections: number;
  completedSections: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建任务参数 */
export interface CreateJobParams {
  documentId: string;
  totalSections: number;
}

// ── 服务实现 ──────────────────────────────────────────────────────────────

/**
 * 生成任务管理服务。
 *
 * 负责管理文章生成任务的生命周期：创建 -> 运行中 -> 完成/失败。
 * 支持进度追踪（已完成章节数 / 总章节数）。
 */
export class GenerationJobService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * 创建新的生成任务。
   *
   * @param params 创建参数
   * @returns 创建的任务对象
   */
  async create(params: CreateJobParams): Promise<GenerationJob> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.db
      .prepare(
        `INSERT INTO generation_jobs (id, document_id, status, total_sections, completed_sections, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, params.documentId, 'pending', params.totalSections, 0, now, now);

    log.info(`Job created: ${id} for document ${params.documentId}, ${params.totalSections} sections`);

    return {
      id,
      documentId: params.documentId,
      status: 'pending',
      totalSections: params.totalSections,
      completedSections: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 根据 ID 获取任务。
   *
   * @param id 任务 ID
   * @returns 任务对象，不存在时返回 null
   */
  async getById(id: string): Promise<GenerationJob | null> {
    const row = this.db.db
      .prepare(
        `SELECT id, document_id AS documentId, status, total_sections AS totalSections,
                completed_sections AS completedSections, error_message AS errorMessage,
                created_at AS createdAt, updated_at AS updatedAt
         FROM generation_jobs WHERE id = ?`,
      )
      .get(id) as GenerationJob | undefined;

    return row || null;
  }

  /**
   * 获取文档的所有生成任务。
   *
   * @param documentId 文档 ID
   * @returns 任务列表，按创建时间降序
   */
  async listByDocument(documentId: string): Promise<GenerationJob[]> {
    return this.db.db
      .prepare(
        `SELECT id, document_id AS documentId, status, total_sections AS totalSections,
                completed_sections AS completedSections, error_message AS errorMessage,
                created_at AS createdAt, updated_at AS updatedAt
         FROM generation_jobs WHERE document_id = ? ORDER BY created_at DESC`,
      )
      .all(documentId) as GenerationJob[];
  }

  /**
   * 将任务状态更新为 running。
   *
   * @param id 任务 ID
   * @returns 更新后的任务对象，不存在时返回 null
   */
  async start(id: string): Promise<GenerationJob | null> {
    return this.updateStatus(id, 'running');
  }

  /**
   * 更新任务进度（已完成章节数）。
   *
   * @param id 任务 ID
   * @param completedSections 已完成的章节数
   * @returns 更新后的任务对象，不存在时返回 null
   */
  async updateProgress(id: string, completedSections: number): Promise<GenerationJob | null> {
    const now = new Date().toISOString();

    const result = this.db.db
      .prepare(
        `UPDATE generation_jobs
         SET completed_sections = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(completedSections, now, id);

    if (result.changes === 0) {
      log.warn(`updateProgress failed: job ${id} not found`);
      return null;
    }

    log.info(`Job ${id} progress: ${completedSections}`);
    return this.getById(id);
  }

  /**
   * 标记任务为完成。
   *
   * @param id 任务 ID
   * @returns 更新后的任务对象，不存在时返回 null
   */
  async markCompleted(id: string): Promise<GenerationJob | null> {
    return this.updateStatus(id, 'completed');
  }

  /**
   * 标记任务为失败，并记录错误信息。
   *
   * @param id 任务 ID
   * @param errorMessage 错误信息
   * @returns 更新后的任务对象，不存在时返回 null
   */
  async markFailed(id: string, errorMessage: string): Promise<GenerationJob | null> {
    const now = new Date().toISOString();

    const result = this.db.db
      .prepare(
        `UPDATE generation_jobs
         SET status = 'failed', error_message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(errorMessage, now, id);

    if (result.changes === 0) {
      log.warn(`markFailed failed: job ${id} not found`);
      return null;
    }

    log.info(`Job ${id} failed: ${errorMessage}`);
    return this.getById(id);
  }

  /**
   * 内部方法：更新任务状态。
   */
  private async updateStatus(id: string, status: JobStatus): Promise<GenerationJob | null> {
    const now = new Date().toISOString();

    const result = this.db.db
      .prepare(
        `UPDATE generation_jobs SET status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, now, id);

    if (result.changes === 0) {
      log.warn(`updateStatus failed: job ${id} not found`);
      return null;
    }

    log.info(`Job ${id} status -> ${status}`);
    return this.getById(id);
  }
}
