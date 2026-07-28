import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLLMConfig } from '../config';

describe('loadLLMConfig', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('loads OpenAI-compatible model settings from the nearest workspace .env', () => {
    const root = join(tmpdir(), `ai-reader-env-${Date.now()}`);
    const nested = join(root, 'apps', 'desktop');
    tempDirs.push(root);
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(root, '.env'),
      [
        'LLM_API_KEY="env-file-key"',
        'LLM_BASE_URL=https://example.test/v1',
        'LLM_MODEL=test-model',
      ].join('\n'),
    );

    const config = loadLLMConfig({ cwd: nested, env: {} });

    expect(config).toEqual({
      apiKey: 'env-file-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    });
  });

  it('keeps process environment values ahead of .env defaults', () => {
    const root = join(tmpdir(), `ai-reader-env-priority-${Date.now()}`);
    tempDirs.push(root);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, '.env'),
      ['LLM_API_KEY=file-key', 'LLM_BASE_URL=https://file.test/v1', 'LLM_MODEL=file-model'].join(
        '\n',
      ),
    );

    const config = loadLLMConfig({
      cwd: root,
      env: { LLM_API_KEY: 'process-key', LLM_MODEL: 'process-model' },
    });

    expect(config.apiKey).toBe('process-key');
    expect(config.model).toBe('process-model');
    expect(config.baseUrl).toBe('https://file.test/v1');
  });
});
