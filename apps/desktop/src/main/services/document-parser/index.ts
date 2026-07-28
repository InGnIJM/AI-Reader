import type { ParsedDocument } from './types';
import { parseMarkdown } from './markdown';
import { parseTxt } from './txt';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('document-parser');

export type { ParsedDocument, Chapter } from './types';

/**
 * 文档解析器，根据文件扩展名分派到对应的解析策略。
 *
 * 支持格式：
 * - `.md` / `.markdown` → 按标题分章节
 * - `.txt` → 整体作为单章节
 */
export class DocumentParser {
  parse(content: string, fileName: string): ParsedDocument {
    const ext = fileName.split('.').pop()?.toLowerCase();
    log.info(`Parsing file: ${fileName} (${ext})`);

    switch (ext) {
      case 'md':
      case 'markdown':
        return parseMarkdown(content, fileName);
      case 'txt':
        return parseTxt(content, fileName);
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }
}
