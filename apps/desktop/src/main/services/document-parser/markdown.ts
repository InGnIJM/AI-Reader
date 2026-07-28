import type { ParsedDocument, Chapter } from './types';
import { createHash } from 'crypto';

/**
 * 解析 Markdown 内容，按标题（# ~ ######）分章节。
 *
 * 规则：
 * - 遇到 `#`~`######` 开头的行视为新章节开始
 * - 标题行之前的内容（preamble）被忽略
 * - 章节 id 基于 `fileName:title` 的 MD5 前 8 位，保证确定性
 * - 章节 content 自动 trim
 * - 如果文件没有标题，将整个文件作为一个章节
 */
export function parseMarkdown(content: string, fileName: string): ParsedDocument {
  const lines = content.split('\n');
  const chapters: Chapter[] = [];
  let currentChapter: { id: string; index: number; title: string; level: number } | null = null;
  let currentContent: string[] = [];

  function flushChapter() {
    if (currentChapter) {
      chapters.push({
        id: currentChapter.id,
        index: currentChapter.index,
        title: currentChapter.title,
        level: currentChapter.level,
        content: currentContent.join('\n').trim(),
      });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushChapter();
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const id = createHash('md5').update(`${fileName}:${title}`).digest('hex').substring(0, 8);
      currentChapter = { id, index: chapters.length, title, level };
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  flushChapter();

  // 如果没有标题，将整个文件作为一个章节
  if (chapters.length === 0 && content.trim()) {
    const id = createHash('md5').update(`${fileName}:__full__`).digest('hex').substring(0, 8);
    chapters.push({
      id,
      index: 0,
      title: fileName.replace(/\.[^.]+$/, ''),
      level: 1,
      content: content.trim(),
    });
  }

  return {
    title: fileName.replace(/\.[^.]+$/, ''),
    chapters,
    rawText: content,
  };
}
