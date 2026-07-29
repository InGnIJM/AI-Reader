import { describe, expect, it } from 'vitest';
import { AnalysisAnchorResolver } from '../anchor-resolver';

const resolver = new AnalysisAnchorResolver();

// ---------------------------------------------------------------------------
// resolve()
// ---------------------------------------------------------------------------
describe('AnalysisAnchorResolver.resolve', () => {
  const md = '# Hello World\n\nThis is a **bold** paragraph with `code` inside.\n\nAnother section.';

  it('returns valid=true when offsets match exactText', () => {
    const start = md.indexOf('bold');
    const result = resolver.resolve({
      markdown: md,
      startOffset: start,
      endOffset: start + 4,
      exactText: 'bold',
    });

    expect(result.valid).toBe(true);
    expect(result.startOffset).toBe(start);
    expect(result.endOffset).toBe(start + 4);
    expect(result.prefix).toContain('**');
    expect(result.suffix).toContain('**');
  });

  it('returns valid=false when startOffset is negative', () => {
    const result = resolver.resolve({
      markdown: md,
      startOffset: -1,
      endOffset: 4,
      exactText: 'Hello',
    });
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when endOffset exceeds markdown length', () => {
    const result = resolver.resolve({
      markdown: md,
      startOffset: 0,
      endOffset: md.length + 10,
      exactText: 'Hello',
    });
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when startOffset >= endOffset', () => {
    const result = resolver.resolve({
      markdown: md,
      startOffset: 5,
      endOffset: 5,
      exactText: '',
    });
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when text at offset does not match exactText', () => {
    const result = resolver.resolve({
      markdown: md,
      startOffset: 0,
      endOffset: 5,
      exactText: 'World', // actual text at 0..5 is "# Hel"
    });
    expect(result.valid).toBe(false);
  });

  it('extracts prefix capped at 50 characters', () => {
    const longMd = 'A'.repeat(100) + 'TARGET' + 'B'.repeat(100);
    const start = longMd.indexOf('TARGET');
    const result = resolver.resolve({
      markdown: longMd,
      startOffset: start,
      endOffset: start + 6,
      exactText: 'TARGET',
    });

    expect(result.valid).toBe(true);
    expect(result.prefix.length).toBeLessThanOrEqual(50);
    expect(result.prefix).toBe('A'.repeat(50));
  });

  it('extracts suffix capped at 50 characters', () => {
    const longMd = 'A'.repeat(100) + 'TARGET' + 'B'.repeat(100);
    const start = longMd.indexOf('TARGET');
    const result = resolver.resolve({
      markdown: longMd,
      startOffset: start,
      endOffset: start + 6,
      exactText: 'TARGET',
    });

    expect(result.valid).toBe(true);
    expect(result.suffix.length).toBeLessThanOrEqual(50);
    expect(result.suffix).toBe('B'.repeat(50));
  });

  it('handles prefix shorter than 50 chars at document start', () => {
    const result = resolver.resolve({
      markdown: 'Hello World',
      startOffset: 0,
      endOffset: 5,
      exactText: 'Hello',
    });

    expect(result.valid).toBe(true);
    expect(result.prefix).toBe('');
  });

  it('handles suffix shorter than 50 chars at document end', () => {
    const result = resolver.resolve({
      markdown: 'Hello World',
      startOffset: 6,
      endOffset: 11,
      exactText: 'World',
    });

    expect(result.valid).toBe(true);
    expect(result.suffix).toBe('');
  });
});

// ---------------------------------------------------------------------------
// relocate()
// ---------------------------------------------------------------------------
describe('AnalysisAnchorResolver.relocate', () => {
  const md = '# Architecture\n\nThe main process owns IPC.\nThe renderer process handles UI.\n\nBoth processes communicate.';

  it('finds text via exact match', () => {
    const result = resolver.relocate({
      markdown: md,
      exactText: 'main process',
      prefix: '',
      suffix: '',
    });

    expect(result.found).toBe(true);
    expect(md.substring(result.startOffset, result.endOffset)).toBe('main process');
  });

  it('returns found=false when text does not exist', () => {
    const result = resolver.relocate({
      markdown: md,
      exactText: 'nonexistent phrase',
      prefix: '',
      suffix: '',
    });

    expect(result.found).toBe(false);
    expect(result.startOffset).toBe(-1);
    expect(result.endOffset).toBe(-1);
  });

  it('uses prefix+suffix to disambiguate duplicate text', () => {
    // "process" appears multiple times
    const occurrences: number[] = [];
    let idx = 0;
    while ((idx = md.indexOf('process', idx)) !== -1) {
      occurrences.push(idx);
      idx += 1;
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    // We want the second occurrence ("renderer process")
    const secondStart = occurrences[1];
    const realPrefix = md.substring(Math.max(0, secondStart - 50), secondStart);
    const realSuffix = md.substring(secondStart + 7, secondStart + 7 + 50);

    const result = resolver.relocate({
      markdown: md,
      exactText: 'process',
      prefix: realPrefix,
      suffix: realSuffix,
    });

    expect(result.found).toBe(true);
    expect(result.startOffset).toBe(secondStart);
    expect(result.endOffset).toBe(secondStart + 7);
  });

  it('falls back to first occurrence when prefix/suffix do not disambiguate', () => {
    // Provide wrong prefix/suffix -- should still find first match
    const result = resolver.relocate({
      markdown: md,
      exactText: 'process',
      prefix: 'WRONG_PREFIX',
      suffix: 'WRONG_SUFFIX',
    });

    // With wrong prefix/suffix and no match, it should still return first occurrence
    expect(result.found).toBe(true);
    expect(md.substring(result.startOffset, result.endOffset)).toBe('process');
  });

  it('handles markdown formatting (bold)', () => {
    const boldMd = 'This is **bold text** in markdown.';
    const result = resolver.relocate({
      markdown: boldMd,
      exactText: 'bold text',
      prefix: 'This is **',
      suffix: '** in markdown.',
    });

    expect(result.found).toBe(true);
    expect(boldMd.substring(result.startOffset, result.endOffset)).toBe('bold text');
  });

  it('handles markdown formatting (inline code)', () => {
    const codeMd = 'Use the `useState` hook for state.';
    const result = resolver.relocate({
      markdown: codeMd,
      exactText: 'useState',
      prefix: 'Use the `',
      suffix: '` hook for state.',
    });

    expect(result.found).toBe(true);
    expect(codeMd.substring(result.startOffset, result.endOffset)).toBe('useState');
  });

  it('handles markdown formatting (link)', () => {
    const linkMd = 'See [the docs](https://example.com) for details.';
    const result = resolver.relocate({
      markdown: linkMd,
      exactText: 'the docs',
      prefix: 'See [',
      suffix: '](https://example.com) for details.',
    });

    expect(result.found).toBe(true);
    expect(linkMd.substring(result.startOffset, result.endOffset)).toBe('the docs');
  });

  it('handles empty markdown gracefully', () => {
    const result = resolver.relocate({
      markdown: '',
      exactText: 'anything',
      prefix: '',
      suffix: '',
    });

    expect(result.found).toBe(false);
  });

  it('handles exactText at document boundaries', () => {
    const result = resolver.relocate({
      markdown: 'Hello World',
      exactText: 'Hello',
      prefix: '',
      suffix: ' World',
    });

    expect(result.found).toBe(true);
    expect(result.startOffset).toBe(0);
    expect(result.endOffset).toBe(5);
  });
});
