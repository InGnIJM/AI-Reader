import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeAnalysisToolRegistry } from '../tool-registry';

describe('CodeAnalysisToolRegistry', () => {
  let root: string;
  let tools: CodeAnalysisToolRegistry;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ai-reader-tools-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
    writeFileSync(join(root, 'src', 'index.ts'), 'export const answer = 42;\nconsole.log(answer);\n');
    writeFileSync(join(root, 'node_modules', 'ignored.js'), 'ignored');
    tools = new CodeAnalysisToolRegistry(root);
  });

  afterEach(() => {
    tools.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists files while ignoring dependency folders', async () => {
    const result = await tools.execute('listFiles', { path: '.', depth: 3 });

    expect(result.content).toContain('package.json');
    expect(result.content).toContain('src/index.ts');
    expect(result.content).not.toContain('node_modules/ignored.js');
  });

  it('reads a file with line bounds', async () => {
    const result = await tools.execute('readFile', { path: 'src/index.ts', startLine: 2, endLine: 2 });

    expect(result.content).toBe('2: console.log(answer);');
  });

  it('searches text and returns path with line number', async () => {
    const result = await tools.execute('searchText', { query: 'answer', path: '.', maxResults: 5 });

    expect(result.content).toContain('src/index.ts:1');
    expect(result.content).toContain('src/index.ts:2');
  });

  it('rejects paths outside the project root', async () => {
    await expect(tools.execute('readFile', { path: '../outside.txt' })).rejects.toThrow(
      'outside the selected project root',
    );
  });
});
