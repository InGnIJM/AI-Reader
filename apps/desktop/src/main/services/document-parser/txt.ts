import type { ParsedDocument } from './types';
import { createHash } from 'crypto';

/**
 * 解析纯文本内容，整体作为单个章节返回。
 *
 * - 章节 id 基于文件名的 MD5 前 8 位，保证确定性
 * - 章节标题取文件名（去掉扩展名）
 */
export function parseTxt(content: string, fileName: string): ParsedDocument {
  const id = createHash('md5').update(fileName).digest('hex').substring(0, 8);
  const title = fileName.replace(/\.[^.]+$/, '');

  return {
    title,
    chapters: [
      {
        id,
        index: 0,
        title,
        level: 1,
        content,
      },
    ],
    rawText: content,
  };
}
