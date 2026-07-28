import Database from 'better-sqlite3';
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
export declare function createDatabase(dbPath: string): DatabaseClient;
//# sourceMappingURL=client.d.ts.map