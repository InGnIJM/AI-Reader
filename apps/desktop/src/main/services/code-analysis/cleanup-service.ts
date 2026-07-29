import { unlink } from 'fs/promises';
import { isAbsolute, join, normalize } from 'path';
import type { DatabaseClient } from '../../db/client';

const MANAGED_PREFIX = 'generated-documents/';

export class AnalysisCleanupService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly userDataRoot: string,
  ) {}

  /**
   * 验证并解析受管文件的绝对路径。
   *
   * 规则：
   * - 拒绝绝对路径
   * - 拒绝包含 `..` 的目录穿越
   * - 只允许 `generated-documents/` 前缀
   */
  resolveManagedPath(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new Error('Absolute paths are not allowed');
    }

    // Normalize to forward slashes for cross-platform comparison
    const normalized = normalize(relativePath).replace(/\\/g, '/');
    if (normalized.includes('..')) {
      throw new Error('Directory traversal (..) is not allowed');
    }

    if (!normalized.startsWith(MANAGED_PREFIX)) {
      throw new Error(`Path must start with "${MANAGED_PREFIX}"`);
    }

    return join(this.userDataRoot, normalized);
  }

  /**
   * 处理清理队列中的所有待处理条目。
   *
   * - 遍历 `analysis_file_cleanup_queue` 表
   * - 删除文件，成功后删除队列记录
   * - ENOENT 视为成功（文件已不存在）
   * - 失败时递增 attempts 并记录 last_error
   * - 只处理队列中的条目，不扫描目录
   */
  async processPending(): Promise<{ processed: number; pending: number }> {
    const rows = this.db.db
      .prepare(
        `SELECT id, relative_path FROM analysis_file_cleanup_queue ORDER BY created_at ASC`,
      )
      .all() as Array<{ id: string; relative_path: string }>;

    let processed = 0;
    let failed = 0;

    const deleteStmt = this.db.db.prepare(
      'DELETE FROM analysis_file_cleanup_queue WHERE id = ?',
    );
    const updateStmt = this.db.db.prepare(
      'UPDATE analysis_file_cleanup_queue SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?',
    );

    for (const row of rows) {
      try {
        const absPath = this.resolveManagedPath(row.relative_path);
        await unlink(absPath);
        deleteStmt.run(row.id);
        processed++;
      } catch (error: unknown) {
        if (isEnoent(error)) {
          // File already gone — treat as success
          deleteStmt.run(row.id);
          processed++;
        } else {
          const message = error instanceof Error ? error.message : String(error);
          const now = new Date().toISOString();
          updateStmt.run(message, now, row.id);
          failed++;
        }
      }
    }

    return { processed, pending: failed };
  }
}

function isEnoent(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
