import { DocumentParser } from '../document-parser';
import type { DatabaseClient } from '../../db/client';
import { createLogger } from '@ai-reader/shared';
import type { DocumentSummary } from '@ai-reader/shared';
import { randomUUID, createHash } from 'crypto';

const log = createLogger('document-import');

/** 文档详情（含 rawText 和 chapters） */
export interface DocumentDetail {
  id: string;
  workspaceId: string;
  fileName: string;
  fileType: string;
  fileHash: string;
  title: string | null;
  rawText: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  chapters: {
    id: string;
    index: number;
    title: string;
    level: number;
    content: string;
  }[];
}

export interface ImportResult {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    fileHash: string;
    title: string;
    status: string;
  };
  chapters: {
    id: string;
    title: string;
    level: number;
  }[];
}

/**
 * 文档服务。
 *
 * 职责：
 * 1. 从内容字符串导入文档：解析结构、计算 SHA256 哈希、持久化到 SQLite
 * 2. 查询文档列表和详情
 */
export class DocumentImportService {
  private parser = new DocumentParser();

  constructor(private db: DatabaseClient) {}

  /**
   * 从内容字符串导入文档。
   *
   * @param workspaceId 工作区 ID
   * @param fileName    文件名（用于推断类型和生成标题）
   * @param content     文档原始内容
   * @returns 导入结果，包含 document 和 chapters 摘要
   * @throws 文件格式不支持时抛出错误
   */
  async importFromContent(
    workspaceId: string,
    fileName: string,
    content: string,
  ): Promise<ImportResult> {
    log.info(`Importing document: ${fileName} into workspace ${workspaceId}`);

    const fileHash = createHash('sha256').update(content).digest('hex');
    const fileType = this.getFileType(fileName);
    const docId = randomUUID();
    const now = new Date().toISOString();

    // Parse document structure
    const parsed = this.parser.parse(content, fileName);

    // Insert document row
    this.db.db
      .prepare(
        `INSERT INTO documents (id, workspace_id, file_name, file_type, file_hash, title, raw_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
      )
      .run(
        docId,
        workspaceId,
        fileName,
        fileType,
        fileHash,
        parsed.title,
        parsed.rawText,
        now,
        now,
      );

    // Insert chapter rows
    const insertChapter = this.db.db.prepare(
      `INSERT INTO chapters (id, document_id, "index", title, level, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const chapter of parsed.chapters) {
      insertChapter.run(
        chapter.id,
        docId,
        chapter.index,
        chapter.title,
        chapter.level,
        chapter.content,
      );
    }

    log.info(
      `Document imported: ${docId}, ${parsed.chapters.length} chapters`,
    );

    return {
      document: {
        id: docId,
        fileName,
        fileType,
        fileHash,
        title: parsed.title,
        status: 'ready',
      },
      chapters: parsed.chapters.map((c) => ({
        id: c.id,
        title: c.title,
        level: c.level,
      })),
    };
  }

  /**
   * 查询指定工作区下的所有文档摘要（不含 rawText）。
   *
   * @param workspaceId 工作区 ID
   * @returns 文档摘要列表，按创建时间降序
   */
  async listByWorkspace(workspaceId: string): Promise<DocumentSummary[]> {
    log.debug(`Listing documents for workspace: ${workspaceId}`);
    return this.db.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, file_name AS fileName, file_type AS fileType,
                file_hash AS fileHash, title, status, created_at AS createdAt, updated_at AS updatedAt
         FROM documents WHERE workspace_id = ? ORDER BY created_at DESC`,
      )
      .all(workspaceId) as DocumentSummary[];
  }

  /**
   * 根据文档 ID 获取文档详情（含 rawText 和 chapters）。
   *
   * @param id 文档 ID
   * @returns 文档详情，不存在时返回 null
   */
  async getById(id: string): Promise<DocumentDetail | null> {
    log.debug(`Getting document by id: ${id}`);
    const row = this.db.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, file_name AS fileName, file_type AS fileType,
                file_hash AS fileHash, title, raw_text AS rawText, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM documents WHERE id = ?`,
      )
      .get(id) as Omit<DocumentDetail, 'chapters'> | undefined;

    if (!row) return null;

    const chapters = this.db.db
      .prepare(
        `SELECT id, "index" AS "index", title, level, content
         FROM chapters WHERE document_id = ? ORDER BY "index"`,
      )
      .all(id) as DocumentDetail['chapters'];

    return { ...row, chapters };
  }

  /**
   * 根据 ID 删除文档（级联删除 chapters）。
   *
   * @param id 文档 ID
   */
  async delete(id: string): Promise<void> {
    log.info(`Deleting document: ${id}`);
    this.db.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }

  /**
   * 根据文件扩展名推断文件类型。
   *
   * @throws 不支持的扩展名时抛出错误
   */
  private getFileType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'txt':
        return 'txt';
      case 'pdf':
        return 'pdf';
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }
}
