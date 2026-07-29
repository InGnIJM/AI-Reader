const CONTEXT_LENGTH = 50;

export interface ResolveResult {
  valid: boolean;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
}

export interface RelocateResult {
  found: boolean;
  startOffset: number;
  endOffset: number;
}

export class AnalysisAnchorResolver {
  /**
   * Validate that the given offsets still point to `exactText` inside
   * `markdown` and return surrounding context for future relocation.
   */
  resolve(params: {
    markdown: string;
    startOffset: number;
    endOffset: number;
    exactText: string;
  }): ResolveResult {
    const { markdown, startOffset, endOffset, exactText } = params;

    if (
      startOffset < 0 ||
      endOffset > markdown.length ||
      startOffset >= endOffset
    ) {
      return { valid: false, startOffset, endOffset, prefix: '', suffix: '' };
    }

    const actual = markdown.substring(startOffset, endOffset);
    if (actual !== exactText) {
      return { valid: false, startOffset, endOffset, prefix: '', suffix: '' };
    }

    const prefix = markdown.substring(
      Math.max(0, startOffset - CONTEXT_LENGTH),
      startOffset,
    );
    const suffix = markdown.substring(
      endOffset,
      Math.min(markdown.length, endOffset + CONTEXT_LENGTH),
    );

    return { valid: true, startOffset, endOffset, prefix, suffix };
  }

  /**
   * Relocate an annotation anchor inside `markdown`.
   *
   * Strategy:
   *  1. Exact-text match.
   *  2. If unique -> return immediately.
   *  3. If multiple -> use prefix + suffix to disambiguate.
   *  4. If disambiguation fails -> return the first occurrence as fallback.
   */
  relocate(params: {
    markdown: string;
    exactText: string;
    prefix: string;
    suffix: string;
  }): RelocateResult {
    const { markdown, exactText, prefix, suffix } = params;

    if (!markdown || !exactText) {
      return { found: false, startOffset: -1, endOffset: -1 };
    }

    // Collect all occurrences
    const occurrences: number[] = [];
    let idx = 0;
    while ((idx = markdown.indexOf(exactText, idx)) !== -1) {
      occurrences.push(idx);
      idx += 1;
    }

    if (occurrences.length === 0) {
      return { found: false, startOffset: -1, endOffset: -1 };
    }

    // Unique match -> return immediately
    if (occurrences.length === 1) {
      const start = occurrences[0];
      return { found: true, startOffset: start, endOffset: start + exactText.length };
    }

    // Multiple matches -> disambiguate with prefix + suffix
    for (const start of occurrences) {
      const actualPrefix = markdown.substring(
        Math.max(0, start - CONTEXT_LENGTH),
        start,
      );
      const actualSuffix = markdown.substring(
        start + exactText.length,
        Math.min(markdown.length, start + exactText.length + CONTEXT_LENGTH),
      );

      if (actualPrefix.endsWith(prefix) && actualSuffix.startsWith(suffix)) {
        return { found: true, startOffset: start, endOffset: start + exactText.length };
      }
    }

    // Fallback: first occurrence
    const start = occurrences[0];
    return { found: true, startOffset: start, endOffset: start + exactText.length };
  }
}
