import Database from 'better-sqlite3';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('db:sqlite');

export interface DatabaseClient {
  db: Database.Database;
  close: () => void;
}

/**
 * 创建并初始化 SQLite 数据库。
 * 包含所有 MVP 表的 CREATE TABLE IF NOT EXISTS 语句和性能索引。
 *
 * @param dbPath 数据库文件路径，':memory:' 用于内存数据库（测试）
 */
export function createDatabase(dbPath: string): DatabaseClient {
  log.info(`Opening database: ${dbPath}`);
  const sqlite = new Database(dbPath);

  // 性能优化 PRAGMA
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // 创建所有 MVP 表
  sqlite.exec(`
    -- 1. 工作区
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 2. 文档
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      title TEXT,
      raw_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'importing',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 3. 章节
    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL,
      title TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL
    );

    -- 4. AI 生成的文章
    CREATE TABLE IF NOT EXISTS generated_articles (
      id TEXT PRIMARY KEY,
      source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      outline_json TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 5. AI 生成的章节
    CREATE TABLE IF NOT EXISTS generated_sections (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES generated_articles(id) ON DELETE CASCADE,
      "index" INTEGER NOT NULL,
      title TEXT NOT NULL,
      source_chapter_ids TEXT NOT NULL,
      content TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 6. 生成任务
    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      total_sections INTEGER NOT NULL DEFAULT 0,
      completed_sections INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 7. 批注
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES generated_articles(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL REFERENCES generated_sections(id) ON DELETE CASCADE,
      anchor_start_offset INTEGER NOT NULL,
      anchor_end_offset INTEGER NOT NULL,
      anchor_exact_text TEXT NOT NULL,
      anchor_prefix TEXT NOT NULL,
      anchor_suffix TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'note',
      content TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 8. 讨论消息
    CREATE TABLE IF NOT EXISTS discussion_messages (
      id TEXT PRIMARY KEY,
      annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model_id TEXT,
      token_usage TEXT,
      created_at TEXT NOT NULL
    );

    -- 9. LLM 使用记录
    CREATE TABLE IF NOT EXISTS llm_usage_records (
      id TEXT PRIMARY KEY,
      request_type TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost REAL,
      created_at TEXT NOT NULL
    );

    -- 10. 应用设置
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 性能索引
    CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_chapters_document ON chapters(document_id);
    CREATE INDEX IF NOT EXISTS idx_generated_articles_source ON generated_articles(source_document_id);
    CREATE INDEX IF NOT EXISTS idx_generated_sections_article ON generated_sections(article_id);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_document ON generation_jobs(document_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_article ON annotations(article_id);
    CREATE INDEX IF NOT EXISTS idx_annotations_section ON annotations(section_id);
    CREATE INDEX IF NOT EXISTS idx_discussion_messages_annotation ON discussion_messages(annotation_id);
  `);

  log.info('Database initialized');

  return {
    db: sqlite,
    close: () => {
      sqlite.close();
      log.info('Database closed');
    },
  };
}
