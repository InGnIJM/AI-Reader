import { describe, it, expect } from 'vitest';
import { DocumentParser } from './index';

describe('DocumentParser', () => {
  const parser = new DocumentParser();

  describe('parseMarkdown', () => {
    it('should parse markdown with chapters by heading', () => {
      const md = `# 第一章 概述

这是第一章的内容。

## 1.1 背景

背景介绍。

# 第二章 详解

这是第二章的内容。`;

      const result = parser.parse(md, 'test.md');

      expect(result.title).toBe('test');
      expect(result.chapters).toHaveLength(3);
      expect(result.chapters[0].title).toBe('第一章 概述');
      expect(result.chapters[0].level).toBe(1);
      expect(result.chapters[0].index).toBe(0);
      expect(result.chapters[0].content).toContain('这是第一章的内容。');
      expect(result.chapters[1].title).toBe('1.1 背景');
      expect(result.chapters[1].level).toBe(2);
      expect(result.chapters[1].index).toBe(1);
      expect(result.chapters[1].content).toContain('背景介绍。');
      expect(result.chapters[2].title).toBe('第二章 详解');
      expect(result.chapters[2].level).toBe(1);
      expect(result.chapters[2].index).toBe(2);
    });

    it('should handle empty markdown', () => {
      const result = parser.parse('', 'empty.md');
      expect(result.chapters).toHaveLength(0);
      expect(result.title).toBe('empty');
      expect(result.rawText).toBe('');
    });

    it('should handle markdown with no headings', () => {
      const md = 'Just some text without headings.\n\nAnother paragraph.';
      const result = parser.parse(md, 'no-headings.md');
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe('no-headings');
      expect(result.chapters[0].content).toBe(md);
    });

    it('should handle markdown with only content before first heading', () => {
      const md = `Some preamble text.

# Chapter One

Content here.`;
      const result = parser.parse(md, 'preamble.md');
      // Preamble before first heading is ignored; only heading-based chapters are extracted
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe('Chapter One');
    });

    it('should generate unique ids per chapter', () => {
      const md = `# A\n\nContent A.\n\n# B\n\nContent B.`;
      const result = parser.parse(md, 'test.md');
      expect(result.chapters[0].id).not.toBe(result.chapters[1].id);
      expect(result.chapters[0].id).toMatch(/^[a-f0-9]{8}$/);
    });

    it('should handle headings from level 1 to level 6', () => {
      const md = `# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6`;
      const result = parser.parse(md, 'levels.md');
      expect(result.chapters).toHaveLength(6);
      expect(result.chapters[0].level).toBe(1);
      expect(result.chapters[1].level).toBe(2);
      expect(result.chapters[2].level).toBe(3);
      expect(result.chapters[3].level).toBe(4);
      expect(result.chapters[4].level).toBe(5);
      expect(result.chapters[5].level).toBe(6);
    });

    it('should preserve rawText', () => {
      const md = `# Title\n\nSome content.`;
      const result = parser.parse(md, 'test.md');
      expect(result.rawText).toBe(md);
    });

    it('should trim chapter content whitespace', () => {
      const md = `# Title\n\n   \n\nContent with leading/trailing whitespace.\n\n   `;
      const result = parser.parse(md, 'test.md');
      expect(result.chapters[0].content).toBe('Content with leading/trailing whitespace.');
    });

    it('should strip .md extension from title', () => {
      const result = parser.parse('# H1', 'readme.md');
      expect(result.title).toBe('readme');
    });

    it('should strip .markdown extension from title', () => {
      const result = parser.parse('# H1', 'guide.markdown');
      expect(result.title).toBe('guide');
    });
  });

  describe('parseTxt', () => {
    it('should parse txt as single chapter', () => {
      const txt = 'This is paragraph one.\n\nThis is paragraph two.';
      const result = parser.parse(txt, 'test.txt');
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].title).toBe('test');
      expect(result.chapters[0].level).toBe(1);
      expect(result.chapters[0].index).toBe(0);
      expect(result.chapters[0].content).toBe(txt);
      expect(result.title).toBe('test');
    });

    it('should handle empty txt', () => {
      const result = parser.parse('', 'empty.txt');
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].content).toBe('');
    });

    it('should generate deterministic id from filename', () => {
      const result1 = parser.parse('content', 'same.txt');
      const result2 = parser.parse('other', 'same.txt');
      expect(result1.chapters[0].id).toBe(result2.chapters[0].id);
    });

    it('should strip .txt extension from title', () => {
      const result = parser.parse('content', 'notes.txt');
      expect(result.title).toBe('notes');
    });

    it('should preserve rawText', () => {
      const txt = 'Line 1\nLine 2\nLine 3';
      const result = parser.parse(txt, 'test.txt');
      expect(result.rawText).toBe(txt);
    });
  });

  describe('unsupported format', () => {
    it('should throw for unsupported file extension', () => {
      expect(() => parser.parse('content', 'file.pdf')).toThrow('Unsupported file format: pdf');
    });

    it('should throw for file with no extension', () => {
      expect(() => parser.parse('content', 'noext')).toThrow();
    });
  });
});
