import { describe, expect, it } from 'vitest';

import {
  hashProjectRootPath,
  normalizeProjectRootPath,
} from '../code-analysis-migration';

describe('code analysis project path identity', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(normalizeProjectRootPath('E:\\code\\AI-Reader\\')).toBe('E:/code/AI-Reader');
  });

  it('preserves a Windows drive root as an absolute path', () => {
    expect(normalizeProjectRootPath('C:\\')).toBe('C:/');
  });

  it('treats Windows path casing and separators as the same project', () => {
    expect(hashProjectRootPath('E:\\code\\AI-Reader')).toBe(
      hashProjectRootPath('e:/code/AI-Reader/'),
    );
  });

  it('keeps different directories distinct', () => {
    expect(hashProjectRootPath('E:/code/AI-Reader')).not.toBe(
      hashProjectRootPath('E:/code/Other'),
    );
  });
});
