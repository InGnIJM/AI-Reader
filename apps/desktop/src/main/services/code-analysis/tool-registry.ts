import { existsSync, readdirSync, readFileSync, statSync } from 'fs';

import { resolveInsideRoot, toProjectRelativePath } from './path-safety';

export type CodeAnalysisToolName = 'listFiles' | 'readFile' | 'searchText';

export interface ToolResult {
  toolName: CodeAnalysisToolName;
  content: string;
}

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo']);
const MAX_READ_CHARS = 20_000;
const MAX_SEARCH_SNIPPET = 220;

export class CodeAnalysisToolRegistry {
  constructor(private readonly rootPath: string) {}

  dispose(): void {}

  async execute(toolName: CodeAnalysisToolName, args: Record<string, unknown>): Promise<ToolResult> {
    if (toolName === 'listFiles') return { toolName, content: this.listFiles(args) };
    if (toolName === 'readFile') return { toolName, content: this.readFile(args) };
    if (toolName === 'searchText') return { toolName, content: this.searchText(args) };
    throw new Error(`Unknown code analysis tool: ${String(toolName)}`);
  }

  private listFiles(args: Record<string, unknown>): string {
    const start = resolveInsideRoot(this.rootPath, String(args.path ?? '.'));
    const depth = clampNumber(args.depth, 2, 0, 8);
    const rows: string[] = [];

    const walk = (dir: string, remainingDepth: number): void => {
      if (remainingDepth < 0) return;

      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (DEFAULT_IGNORES.has(entry.name)) continue;

        const absolutePath = resolveInsideRoot(dir, entry.name);
        const relativePath = toProjectRelativePath(this.rootPath, absolutePath);

        if (entry.isDirectory()) {
          rows.push(`${relativePath}/`);
          walk(absolutePath, remainingDepth - 1);
        } else {
          rows.push(relativePath);
        }
      }
    };

    if (!existsSync(start)) return '';
    if (statSync(start).isDirectory()) {
      walk(start, depth);
      return rows.sort().join('\n');
    }

    return toProjectRelativePath(this.rootPath, start);
  }

  private readFile(args: Record<string, unknown>): string {
    const requestedPath = String(args.path ?? '');
    if (!requestedPath) throw new Error('readFile requires a path');

    const absolutePath = resolveInsideRoot(this.rootPath, requestedPath);
    const text = readFileSync(absolutePath, 'utf8').slice(0, MAX_READ_CHARS);
    const lines = text.split(/\r?\n/);
    const startLine = clampNumber(args.startLine, 1, 1, lines.length);
    const endLine = clampNumber(args.endLine, lines.length, startLine, lines.length);

    return lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n');
  }

  private searchText(args: Record<string, unknown>): string {
    const query = String(args.query ?? '');
    if (!query) throw new Error('searchText requires a query');

    const start = resolveInsideRoot(this.rootPath, String(args.path ?? '.'));
    const maxResults = clampNumber(args.maxResults, 20, 1, 100);
    const results: string[] = [];

    const visit = (absolutePath: string): void => {
      if (results.length >= maxResults) return;
      const stat = statSync(absolutePath);

      if (stat.isDirectory()) {
        for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
          if (DEFAULT_IGNORES.has(entry.name)) continue;
          visit(resolveInsideRoot(absolutePath, entry.name));
          if (results.length >= maxResults) return;
        }
        return;
      }

      const text = readFileSync(absolutePath, 'utf8').slice(0, MAX_READ_CHARS);
      text.split(/\r?\n/).forEach((line, index) => {
        if (results.length >= maxResults) return;
        if (!line.includes(query)) return;

        const snippet = line.length > MAX_SEARCH_SNIPPET ? `${line.slice(0, MAX_SEARCH_SNIPPET)}...` : line;
        results.push(`${toProjectRelativePath(this.rootPath, absolutePath)}:${index + 1}: ${snippet}`);
      });
    };

    if (existsSync(start)) visit(start);
    return results.join('\n');
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}
