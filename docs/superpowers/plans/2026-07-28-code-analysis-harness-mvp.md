# Code Analysis Harness MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the code analysis MVP: select a code directory, let a model autonomously call read-only tools to generate a Markdown analysis document, add Feishu-like comments to generated text, auto-reply to comments, and export/import annotated analysis packages.

**Architecture:** Add a code-analysis slice beside the existing document-reading slice. The main process owns SQLite persistence, read-only project tools, prompt/context building, tool-loop orchestration, export/import, and IPC. The renderer reuses existing Markdown, selection, annotation, and streaming components inside a new dark workbench.

**Tech Stack:** Electron 33, React 19, TypeScript, Vitest, better-sqlite3, OpenAI-compatible chat completions through the existing `LLMProvider`.

---

## Test Plan First

The implementation must be test-first. Each task starts with a failing test and a command that proves it fails before implementation.

Testing layers:

- Unit tests for harness modules: path safety, read-only tools, context builder, prompt builder, tool loop, export/import.
- Service integration tests with in-memory SQLite and a mock LLM.
- Renderer component tests for prompt input, tool trace display, Markdown selection, comment creation, reply display, export/import states.
- One full service E2E test: fixture project -> autonomous tool calls -> Markdown analysis -> comment -> AI reply -> export -> import.

Test file convention:

- New tests use project-required folders such as `apps/desktop/src/main/services/code-analysis/test/test_tool-registry.ts`.
- Vitest must be configured to discover `test/test_*.ts` and `test/test_*.tsx`.
- Every code task has a focused test command and a final package-level command.

Core verification commands:

```bash
pnpm --filter @ai-reader/desktop test
pnpm --filter @ai-reader/desktop test -- --coverage
pnpm test
```

Known precondition:

- Current desktop tests already fail before this MVP. Task 0 isolates new test discovery and records the baseline. A worker must not claim the MVP is complete until the new code-analysis tests pass and any remaining unrelated legacy failures are explicitly listed.

## File Structure

Create or modify these files.

### Shared Types And IPC

- Modify `packages/shared/src/ipc/channels.ts`: add `codeAnalysis:*`, `analysisAnnotation:*`, and `analysisExport:*` channel constants.
- Modify `packages/shared/src/ipc/types.ts`: add payload/result types for projects, analysis documents, tool traces, comments, reply messages, exports, and imports.

### Main Process Data

- Modify `apps/desktop/src/main/db/schema.ts`: add Drizzle table declarations for code-analysis tables.
- Modify `apps/desktop/src/main/db/client.ts`: add `CREATE TABLE IF NOT EXISTS` SQL and indexes.

### Main Process Harness

- Create `apps/desktop/src/main/services/code-analysis/types.ts`: domain types shared by harness services.
- Create `apps/desktop/src/main/services/code-analysis/path-safety.ts`: root-bound path resolution helpers.
- Create `apps/desktop/src/main/services/code-analysis/tool-registry.ts`: `listFiles`, `readFile`, `searchText`.
- Create `apps/desktop/src/main/services/code-analysis/context-builder.ts`: project index, ignore rules, result truncation.
- Create `apps/desktop/src/main/services/code-analysis/prompt-builder.ts`: stable prompts and final output contract.
- Create `apps/desktop/src/main/services/code-analysis/tool-loop.ts`: autonomous model loop with 15-call budget.
- Create `apps/desktop/src/main/services/code-analysis/service.ts`: persistence and orchestration for projects/documents/traces.
- Create `apps/desktop/src/main/services/code-analysis/annotation-service.ts`: analysis document comments and messages.
- Create `apps/desktop/src/main/services/code-analysis/reply-engine.ts`: automatic AI replies for comments.
- Create `apps/desktop/src/main/services/code-analysis/export-service.ts`: Markdown export, `.aireader.json` export/import.
- Create `apps/desktop/src/main/services/code-analysis/index.ts`: public exports.

### Main Process IPC

- Create `apps/desktop/src/main/ipc/code-analysis.ts`: handlers for project selection, analysis start, document queries, traces, comments, replies, export/import.
- Modify `apps/desktop/src/main/ipc/index.ts`: instantiate and register code-analysis handlers.
- Modify `apps/desktop/src/preload/index.ts`: expose `window.api.codeAnalysis`.
- Modify `apps/desktop/src/renderer/env.d.ts`: type `window.api.codeAnalysis`.

### Renderer

- Create `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`: page shell.
- Create `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css`: dark workbench layout.
- Create `apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/AnalysisPromptBox.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/ToolTraceTimeline.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/AnalysisMarkdownViewer.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/AnnotationSidebar.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/ExportMenu.tsx`.
- Create `apps/desktop/src/renderer/components/code-analysis/index.ts`.
- Modify `apps/desktop/src/renderer/App.tsx`: route initial MVP view to `CodeAnalysisWorkbench`.
- Modify `apps/desktop/src/renderer/styles/globals.css`: add dark code-analysis tokens.

## Task 0: Test Harness Discovery And Baseline

**Files:**
- Modify: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/main/services/code-analysis/test/test_vitest-discovery.ts`

- [ ] **Step 1: Write the failing discovery test**

Create `apps/desktop/src/main/services/code-analysis/test/test_vitest-discovery.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('code-analysis test discovery', () => {
  it('runs test files named test_*.ts inside test directories', () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run discovery test to verify it fails to run**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_vitest-discovery.ts
```

Expected: Vitest reports no matching test file or does not execute the named `test_*.ts` file.

- [ ] **Step 3: Update Vitest include patterns**

Modify `apps/desktop/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'src/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/**/test/test_*.ts',
      'src/**/test/test_*.tsx',
    ],
    server: {
      deps: {
        external: [/better-sqlite3/],
      },
    },
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom'],
    ],
    setupFiles: ['src/renderer/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/main/services/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/test/**', '**/types.ts'],
    },
  },
});
```

- [ ] **Step 4: Run discovery test to verify it passes**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_vitest-discovery.ts
```

Expected: one test file passes.

- [ ] **Step 5: Capture baseline**

Run:

```bash
pnpm --filter @ai-reader/desktop test
```

Expected: the new discovery test passes. If legacy tests still fail, record the failure summary in the task notes before continuing.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/vitest.config.ts apps/desktop/src/main/services/code-analysis/test/test_vitest-discovery.ts
git commit -m "test(desktop): enable code analysis test discovery"
```

## Task 1: Code Analysis Types And Database Tables

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/types.ts`
- Modify: `apps/desktop/src/main/db/schema.ts`
- Modify: `apps/desktop/src/main/db/client.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`

- [ ] **Step 1: Write failing schema test**

Create `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../db/client';

describe('code-analysis database schema', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('creates code analysis tables and cascades document children', () => {
    const now = new Date().toISOString();

    db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('project-1', 'AI-Reader', 'E:/code/AI-Reader', 'hash-1', now, now);

    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('doc-1', 'project-1', 'Analyze architecture', '# Result', 'completed', 'gpt-test', 2, now, now);

    db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('trace-1', 'doc-1', 0, 'listFiles', '{}', 'package.json', now);

    db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ann-1', 'doc-1', 0, 6, 'Result', '# ', '', 'Explain this', 'answered', now, now);

    db.db.prepare(`
      INSERT INTO analysis_discussion_messages
        (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('msg-1', 'ann-1', 'assistant', 'Explanation', 'gpt-test', now);

    db.db.prepare('DELETE FROM analysis_documents WHERE id = ?').run('doc-1');

    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_tool_traces').get()).toEqual({ count: 0 });
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_annotations').get()).toEqual({ count: 0 });
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages').get()).toEqual({ count: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_schema.ts
```

Expected: FAIL with `no such table: code_projects`.

- [ ] **Step 3: Add domain types**

Create `apps/desktop/src/main/services/code-analysis/types.ts`:

```ts
export type AnalysisStatus = 'pending' | 'running' | 'completed' | 'failed';
export type AnalysisAnnotationStatus = 'pending' | 'answered' | 'failed';
export type AnalysisMessageRole = 'user' | 'assistant';

export interface CodeProject {
  id: string;
  name: string;
  rootPath: string;
  rootPathHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisDocument {
  id: string;
  projectId: string;
  goal: string;
  contentMarkdown: string;
  status: AnalysisStatus;
  modelId?: string;
  toolCallCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisToolTrace {
  id: string;
  analysisDocumentId: string;
  stepIndex: number;
  toolName: string;
  toolArgsJson: string;
  resultSummary: string;
  createdAt: string;
}

export interface AnalysisAnnotation {
  id: string;
  analysisDocumentId: string;
  anchorStartOffset: number;
  anchorEndOffset: number;
  anchorExactText: string;
  anchorPrefix: string;
  anchorSuffix: string;
  question: string;
  status: AnalysisAnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisDiscussionMessage {
  id: string;
  annotationId: string;
  role: AnalysisMessageRole;
  content: string;
  modelId?: string;
  createdAt: string;
}
```

- [ ] **Step 4: Add SQL tables**

Append these SQL blocks inside the `sqlite.exec` call in `apps/desktop/src/main/db/client.ts`:

```sql
CREATE TABLE IF NOT EXISTS code_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  root_path_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES code_projects(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  content_markdown TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  model_id TEXT,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_tool_traces (
  id TEXT PRIMARY KEY,
  analysis_document_id TEXT NOT NULL REFERENCES analysis_documents(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args_json TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_annotations (
  id TEXT PRIMARY KEY,
  analysis_document_id TEXT NOT NULL REFERENCES analysis_documents(id) ON DELETE CASCADE,
  anchor_start_offset INTEGER NOT NULL,
  anchor_end_offset INTEGER NOT NULL,
  anchor_exact_text TEXT NOT NULL,
  anchor_prefix TEXT NOT NULL,
  anchor_suffix TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_discussion_messages (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES analysis_annotations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_documents_project ON analysis_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tool_traces_document ON analysis_tool_traces(analysis_document_id);
CREATE INDEX IF NOT EXISTS idx_analysis_annotations_document ON analysis_annotations(analysis_document_id);
CREATE INDEX IF NOT EXISTS idx_analysis_discussion_messages_annotation ON analysis_discussion_messages(annotation_id);
```

Add matching Drizzle table declarations to `apps/desktop/src/main/db/schema.ts` using the same table and column names.

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_schema.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/types.ts apps/desktop/src/main/db/schema.ts apps/desktop/src/main/db/client.ts apps/desktop/src/main/services/code-analysis/test/test_schema.ts
git commit -m "feat(code-analysis): add persistence schema"
```

## Task 2: Read-Only Tool Registry

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/path-safety.ts`
- Create: `apps/desktop/src/main/services/code-analysis/tool-registry.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_tool-registry.ts`

- [ ] **Step 1: Write failing read-only tool tests**

Create `apps/desktop/src/main/services/code-analysis/test/test_tool-registry.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
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
    tools.dispose?.();
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
    await expect(tools.execute('readFile', { path: '../outside.txt' })).rejects.toThrow('outside the selected project root');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_tool-registry.ts
```

Expected: FAIL with module not found for `../tool-registry`.

- [ ] **Step 3: Add path safety helper**

Create `apps/desktop/src/main/services/code-analysis/path-safety.ts`:

```ts
import { resolve, relative, sep } from 'path';

export function resolveInsideRoot(rootPath: string, requestedPath = '.'): string {
  const root = resolve(rootPath);
  const target = resolve(root, requestedPath);
  const rel = relative(root, target);

  if (rel === '') return target;
  if (rel.startsWith('..') || rel === '..' || rel.includes(`..${sep}`)) {
    throw new Error(`Path is outside the selected project root: ${requestedPath}`);
  }

  return target;
}

export function toProjectRelativePath(rootPath: string, absolutePath: string): string {
  return relative(resolve(rootPath), resolve(absolutePath)).replace(/\\/g, '/');
}
```

- [ ] **Step 4: Add tool registry implementation**

Create `apps/desktop/src/main/services/code-analysis/tool-registry.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
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
    const depth = Number(args.depth ?? 2);
    const rows: string[] = [];

    const walk = (dir: string, remainingDepth: number): void => {
      if (remainingDepth < 0) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (DEFAULT_IGNORES.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        const rel = toProjectRelativePath(this.rootPath, abs);
        rows.push(entry.isDirectory() ? `${rel}/` : rel);
        if (entry.isDirectory()) walk(abs, remainingDepth - 1);
      }
    };

    walk(start, depth);
    return rows.sort().join('\n');
  }

  private readFile(args: Record<string, unknown>): string {
    const path = String(args.path ?? '');
    const abs = resolveInsideRoot(this.rootPath, path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      throw new Error(`File not found: ${path}`);
    }

    const text = readFileSync(abs, 'utf8').slice(0, MAX_READ_CHARS);
    const lines = text.split(/\r?\n/);
    const startLine = Math.max(1, Number(args.startLine ?? 1));
    const endLine = Math.min(lines.length, Number(args.endLine ?? lines.length));

    return lines
      .slice(startLine - 1, endLine)
      .map((line, index) => `${startLine + index}: ${line}`)
      .join('\n');
  }

  private searchText(args: Record<string, unknown>): string {
    const query = String(args.query ?? '');
    if (!query.trim()) throw new Error('searchText query is required');

    const start = resolveInsideRoot(this.rootPath, String(args.path ?? '.'));
    const maxResults = Math.max(1, Number(args.maxResults ?? 20));
    const matches: string[] = [];

    const visit = (abs: string): void => {
      if (matches.length >= maxResults) return;
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(abs, { withFileTypes: true })) {
          if (DEFAULT_IGNORES.has(entry.name)) continue;
          visit(join(abs, entry.name));
        }
        return;
      }
      if (!stat.isFile()) return;

      const content = readFileSync(abs, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (matches.length < maxResults && line.includes(query)) {
          const rel = toProjectRelativePath(this.rootPath, abs);
          matches.push(`${rel}:${index + 1}: ${line.slice(0, MAX_SEARCH_SNIPPET)}`);
        }
      });
    };

    visit(start);
    return matches.join('\n');
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_tool-registry.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/path-safety.ts apps/desktop/src/main/services/code-analysis/tool-registry.ts apps/desktop/src/main/services/code-analysis/test/test_tool-registry.ts
git commit -m "feat(code-analysis): add read-only tool registry"
```

## Task 3: Context Builder And Prompt Builder

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/context-builder.ts`
- Create: `apps/desktop/src/main/services/code-analysis/prompt-builder.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_context-prompt.ts`

- [ ] **Step 1: Write failing context and prompt tests**

Create `apps/desktop/src/main/services/code-analysis/test/test_context-prompt.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProjectContext, summarizeToolResult } from '../context-builder';
import { buildAnalysisMessages } from '../prompt-builder';

describe('code analysis context and prompt builders', () => {
  it('summarizes overlong tool results', () => {
    const long = 'A'.repeat(5000);
    const summary = summarizeToolResult(long, 120);
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).toContain('[truncated');
  });

  it('builds a project context with available tools and budget', () => {
    const context = buildProjectContext({
      projectName: 'AI-Reader',
      rootPathHash: 'hash-1',
      fileIndex: ['package.json', 'src/main.ts'],
      maxToolCalls: 15,
    });

    expect(context).toContain('AI-Reader');
    expect(context).toContain('listFiles');
    expect(context).toContain('readFile');
    expect(context).toContain('searchText');
    expect(context).toContain('15');
  });

  it('builds analysis messages with the user goal and final Markdown contract', () => {
    const messages = buildAnalysisMessages({
      goal: 'Explain startup flow',
      projectContext: 'Project context here',
      traceSummary: 'No tools used yet',
    });

    expect(messages[0].role).toBe('system');
    expect(messages.map((m) => m.content).join('\n')).toContain('read-only');
    expect(messages.map((m) => m.content).join('\n')).toContain('Explain startup flow');
    expect(messages.map((m) => m.content).join('\n')).toContain('Markdown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_context-prompt.ts
```

Expected: FAIL with module not found for `../context-builder`.

- [ ] **Step 3: Add context builder**

Create `apps/desktop/src/main/services/code-analysis/context-builder.ts`:

```ts
export interface BuildProjectContextInput {
  projectName: string;
  rootPathHash: string;
  fileIndex: string[];
  maxToolCalls: number;
}

export function summarizeToolResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n[truncated ${content.length - maxChars} chars]`;
}

export function buildProjectContext(input: BuildProjectContextInput): string {
  return [
    `Project: ${input.projectName}`,
    `Root path hash: ${input.rootPathHash}`,
    `Max tool calls: ${input.maxToolCalls}`,
    '',
    'Available read-only tools:',
    '- listFiles(path?, depth?)',
    '- readFile(path, startLine?, endLine?)',
    '- searchText(query, path?, maxResults?)',
    '',
    'Initial file index:',
    ...input.fileIndex.map((file) => `- ${file}`),
  ].join('\n');
}
```

- [ ] **Step 4: Add prompt builder**

Create `apps/desktop/src/main/services/code-analysis/prompt-builder.ts`:

```ts
import type { ChatMessage } from '@ai-reader/core';

export interface BuildAnalysisMessagesInput {
  goal: string;
  projectContext: string;
  traceSummary: string;
}

export function buildAnalysisMessages(input: BuildAnalysisMessagesInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are a read-only code analysis assistant inside AI-Reader.',
        'You may request read-only tools when evidence is missing.',
        'Never modify files, never run shell commands, and never claim evidence you did not inspect.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '## Project Context',
        input.projectContext,
        '',
        '## Tool Trace So Far',
        input.traceSummary,
        '',
        '## User Analysis Goal',
        input.goal,
        '',
        '## Final Output Contract',
        'Return a Markdown document shaped by the user goal.',
        'Include file path references when claims depend on project files.',
        'Label uncertainty when evidence is missing or budget is exhausted.',
      ].join('\n'),
    },
  ];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_context-prompt.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/context-builder.ts apps/desktop/src/main/services/code-analysis/prompt-builder.ts apps/desktop/src/main/services/code-analysis/test/test_context-prompt.ts
git commit -m "feat(code-analysis): add context and prompt builders"
```

## Task 4: Autonomous Tool Loop With Mock LLM

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/tool-loop.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_tool-loop.ts`

- [ ] **Step 1: Write failing tool-loop tests**

Create `apps/desktop/src/main/services/code-analysis/test/test_tool-loop.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider, ChatCompletionRequest, ChatCompletionResponse } from '@ai-reader/core';
import { runCodeAnalysisToolLoop } from '../tool-loop';

class MockToolCallingLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  private calls = 0;

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls += 1;
    const content = request.messages.map((m) => m.content).join('\n');

    if (this.calls === 1) {
      return this.response(JSON.stringify({ tool: 'listFiles', args: { path: '.', depth: 2 } }));
    }
    if (this.calls === 2) {
      expect(content).toContain('package.json');
      return this.response('# Startup Flow\n\nEvidence: `package.json`.');
    }
    return this.response('# Done');
  }

  chatStream(): AsyncIterable<any> {
    throw new Error('not used');
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }

  private response(content: string): ChatCompletionResponse {
    return {
      id: `resp-${this.calls}`,
      content,
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }
}

describe('runCodeAnalysisToolLoop', () => {
  it('executes requested tools and returns final Markdown', async () => {
    const executeTool = vi.fn(async () => ({ toolName: 'listFiles' as const, content: 'package.json' }));

    const result = await runCodeAnalysisToolLoop({
      llm: new MockToolCallingLLM(),
      messages: [{ role: 'user', content: 'Analyze startup' }],
      executeTool,
      maxToolCalls: 15,
    });

    expect(executeTool).toHaveBeenCalledWith('listFiles', { path: '.', depth: 2 });
    expect(result.markdown).toContain('# Startup Flow');
    expect(result.traces).toHaveLength(1);
  });

  it('stops when tool call budget is exhausted', async () => {
    class AlwaysToolLLM extends MockToolCallingLLM {
      async chat(): Promise<ChatCompletionResponse> {
        return {
          id: 'tool',
          content: JSON.stringify({ tool: 'searchText', args: { query: 'x' } }),
          model: this.defaultModel,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      }
    }

    const result = await runCodeAnalysisToolLoop({
      llm: new AlwaysToolLLM(),
      messages: [{ role: 'user', content: 'Analyze' }],
      executeTool: async () => ({ toolName: 'searchText', content: 'x' }),
      maxToolCalls: 2,
    });

    expect(result.traces).toHaveLength(2);
    expect(result.markdown).toContain('Tool call budget exhausted');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_tool-loop.ts
```

Expected: FAIL with module not found for `../tool-loop`.

- [ ] **Step 3: Add tool loop**

Create `apps/desktop/src/main/services/code-analysis/tool-loop.ts`:

```ts
import type { ChatMessage, LLMProvider } from '@ai-reader/core';
import { summarizeToolResult } from './context-builder';
import type { CodeAnalysisToolName, ToolResult } from './tool-registry';

export interface ToolLoopTrace {
  stepIndex: number;
  toolName: CodeAnalysisToolName;
  toolArgs: Record<string, unknown>;
  resultSummary: string;
}

export interface RunToolLoopInput {
  llm: LLMProvider;
  messages: ChatMessage[];
  executeTool: (name: CodeAnalysisToolName, args: Record<string, unknown>) => Promise<ToolResult>;
  maxToolCalls: number;
}

export interface RunToolLoopResult {
  markdown: string;
  traces: ToolLoopTrace[];
  modelId: string;
}

interface ToolRequest {
  tool: CodeAnalysisToolName;
  args: Record<string, unknown>;
}

function parseToolRequest(content: string): ToolRequest | null {
  try {
    const parsed = JSON.parse(content) as Partial<ToolRequest>;
    if (
      parsed &&
      (parsed.tool === 'listFiles' || parsed.tool === 'readFile' || parsed.tool === 'searchText') &&
      typeof parsed.args === 'object' &&
      parsed.args !== null
    ) {
      return { tool: parsed.tool, args: parsed.args };
    }
    return null;
  } catch {
    return null;
  }
}

export async function runCodeAnalysisToolLoop(input: RunToolLoopInput): Promise<RunToolLoopResult> {
  const messages = [...input.messages];
  const traces: ToolLoopTrace[] = [];

  for (let step = 0; step <= input.maxToolCalls; step += 1) {
    const response = await input.llm.chat({ messages, temperature: 0.2 });
    const toolRequest = parseToolRequest(response.content);

    if (!toolRequest) {
      return { markdown: response.content, traces, modelId: response.model };
    }

    if (traces.length >= input.maxToolCalls) {
      return {
        markdown: [
          '# Analysis Incomplete',
          '',
          'Tool call budget exhausted before the model produced a final answer.',
          'Please rerun with a narrower goal or a larger budget.',
        ].join('\n'),
        traces,
        modelId: response.model,
      };
    }

    const toolResult = await input.executeTool(toolRequest.tool, toolRequest.args);
    const resultSummary = summarizeToolResult(toolResult.content, 4000);
    traces.push({
      stepIndex: traces.length,
      toolName: toolRequest.tool,
      toolArgs: toolRequest.args,
      resultSummary,
    });

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        `Tool result for ${toolRequest.tool}:`,
        resultSummary,
        '',
        'Continue analysis. Request another tool as JSON or return final Markdown.',
      ].join('\n'),
    });
  }

  return {
    markdown: '# Analysis Incomplete\n\nTool loop ended without a final Markdown answer.',
    traces,
    modelId: input.llm.defaultModel,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_tool-loop.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/tool-loop.ts apps/desktop/src/main/services/code-analysis/test/test_tool-loop.ts
git commit -m "feat(code-analysis): add autonomous tool loop"
```

## Task 5: Code Analysis Persistence Service

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/service.ts`
- Create: `apps/desktop/src/main/services/code-analysis/index.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_service.ts`

- [ ] **Step 1: Write failing service integration test**

Create `apps/desktop/src/main/services/code-analysis/test/test_service.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LLMProvider, ChatCompletionRequest, ChatCompletionResponse } from '@ai-reader/core';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { CodeAnalysisService } from '../service';

class OneToolThenMarkdownLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-model';
  private calls = 0;

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls += 1;
    return {
      id: `resp-${this.calls}`,
      content: this.calls === 1
        ? JSON.stringify({ tool: 'listFiles', args: { path: '.', depth: 1 } })
        : '# Project Summary\n\nUses `package.json`.',
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }

  chatStream(): AsyncIterable<any> {
    throw new Error('not used');
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('CodeAnalysisService', () => {
  let db: DatabaseClient;
  let root: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    root = mkdtempSync(join(tmpdir(), 'ai-reader-project-'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a project, runs analysis, stores Markdown and tool traces', async () => {
    const service = new CodeAnalysisService({ db, llm: new OneToolThenMarkdownLLM() });
    const project = await service.createProject(root);
    const document = await service.runAnalysis({ projectId: project.id, goal: 'Summarize project' });

    expect(document.status).toBe('completed');
    expect(document.contentMarkdown).toContain('# Project Summary');
    expect(document.toolCallCount).toBe(1);

    const traces = await service.listToolTraces(document.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].toolName).toBe('listFiles');
    expect(traces[0].resultSummary).toContain('package.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_service.ts
```

Expected: FAIL with module not found for `../service`.

- [ ] **Step 3: Add service implementation**

Create `apps/desktop/src/main/services/code-analysis/service.ts` with:

```ts
import { basename } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { LLMProvider } from '@ai-reader/core';
import type { DatabaseClient } from '../../db/client';
import { buildProjectContext } from './context-builder';
import { buildAnalysisMessages } from './prompt-builder';
import { CodeAnalysisToolRegistry } from './tool-registry';
import { runCodeAnalysisToolLoop } from './tool-loop';
import type { AnalysisDocument, AnalysisToolTrace, CodeProject } from './types';

export class CodeAnalysisService {
  constructor(private readonly deps: { db: DatabaseClient; llm: LLMProvider }) {}

  async createProject(rootPath: string): Promise<CodeProject> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const name = basename(rootPath);
    const rootPathHash = createHash('sha256').update(rootPath).digest('hex');

    this.deps.db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, rootPath, rootPathHash, now, now);

    return { id, name, rootPath, rootPathHash, createdAt: now, updatedAt: now };
  }

  async getProject(id: string): Promise<CodeProject | null> {
    const row = this.deps.db.db.prepare(`
      SELECT id, name, root_path AS rootPath, root_path_hash AS rootPathHash,
             created_at AS createdAt, updated_at AS updatedAt
      FROM code_projects WHERE id = ?
    `).get(id) as CodeProject | undefined;
    return row ?? null;
  }

  async runAnalysis(input: { projectId: string; goal: string }): Promise<AnalysisDocument> {
    const project = await this.getProject(input.projectId);
    if (!project) throw new Error(`Code project not found: ${input.projectId}`);

    const docId = randomUUID();
    const now = new Date().toISOString();
    this.deps.db.db.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES (?, ?, ?, '', 'running', 0, ?, ?)
    `).run(docId, project.id, input.goal, now, now);

    const tools = new CodeAnalysisToolRegistry(project.rootPath);
    const fileIndex = (await tools.execute('listFiles', { path: '.', depth: 2 })).content.split('\n').filter(Boolean);
    const projectContext = buildProjectContext({
      projectName: project.name,
      rootPathHash: project.rootPathHash,
      fileIndex,
      maxToolCalls: 15,
    });
    const messages = buildAnalysisMessages({
      goal: input.goal,
      projectContext,
      traceSummary: 'No tools used yet.',
    });
    const result = await runCodeAnalysisToolLoop({
      llm: this.deps.llm,
      messages,
      executeTool: (name, args) => tools.execute(name, args),
      maxToolCalls: 15,
    });

    const traceInsert = this.deps.db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const trace of result.traces) {
      traceInsert.run(randomUUID(), docId, trace.stepIndex, trace.toolName, JSON.stringify(trace.toolArgs), trace.resultSummary, new Date().toISOString());
    }

    const doneAt = new Date().toISOString();
    this.deps.db.db.prepare(`
      UPDATE analysis_documents
      SET content_markdown = ?, status = 'completed', model_id = ?, tool_call_count = ?, updated_at = ?
      WHERE id = ?
    `).run(result.markdown, result.modelId, result.traces.length, doneAt, docId);

    const document = await this.getDocument(docId);
    if (!document) throw new Error(`Analysis document not found after creation: ${docId}`);
    return document;
  }

  async getDocument(id: string): Promise<AnalysisDocument | null> {
    const row = this.deps.db.db.prepare(`
      SELECT id, project_id AS projectId, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents WHERE id = ?
    `).get(id) as AnalysisDocument | undefined;
    return row ?? null;
  }

  async listToolTraces(documentId: string): Promise<AnalysisToolTrace[]> {
    return this.deps.db.db.prepare(`
      SELECT id, analysis_document_id AS analysisDocumentId, step_index AS stepIndex,
             tool_name AS toolName, tool_args_json AS toolArgsJson,
             result_summary AS resultSummary, created_at AS createdAt
      FROM analysis_tool_traces
      WHERE analysis_document_id = ?
      ORDER BY step_index ASC
    `).all(documentId) as AnalysisToolTrace[];
  }
}
```

Create `apps/desktop/src/main/services/code-analysis/index.ts`:

```ts
export * from './types';
export * from './service';
export * from './tool-registry';
export * from './tool-loop';
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_service.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/service.ts apps/desktop/src/main/services/code-analysis/index.ts apps/desktop/src/main/services/code-analysis/test/test_service.ts
git commit -m "feat(code-analysis): persist analysis documents"
```

## Task 6: Analysis Comments And Automatic Replies

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/annotation-service.ts`
- Create: `apps/desktop/src/main/services/code-analysis/reply-engine.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts`

- [ ] **Step 1: Write failing annotation and reply test**

Create `apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LLMProvider, ChatCompletionRequest, ChatCompletionChunk } from '@ai-reader/core';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { AnalysisAnnotationService } from '../annotation-service';
import { AnalysisReplyEngine } from '../reply-engine';

class StreamingReplyLLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-reply';
  async chat(): Promise<any> {
    throw new Error('not used');
  }
  async *chatStream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    yield { id: '1', delta: 'This ', done: false };
    yield { id: '2', delta: 'explains it.', done: false };
    yield {
      id: '3',
      delta: '',
      done: true,
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      finishReason: 'stop',
    };
  }
  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('analysis annotations and replies', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const now = new Date().toISOString();
    db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES ('project-1', 'Project', 'root', 'hash', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'project-1', 'Explain architecture', '# Architecture\n\nThe main process owns IPC.', 'completed', 'mock', 0, ?, ?)
    `).run(now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('creates a comment anchor and auto-saves an AI reply', async () => {
    const annotations = new AnalysisAnnotationService(db);
    const annotation = await annotations.create({
      analysisDocumentId: 'doc-1',
      selectedText: 'main process',
      question: 'What does this mean?',
    });

    expect(annotation.anchorStartOffset).toBeGreaterThanOrEqual(0);
    expect(annotation.anchorExactText).toBe('main process');
    expect(annotation.status).toBe('pending');

    const engine = new AnalysisReplyEngine({ db, llm: new StreamingReplyLLM(), annotationService: annotations });
    const chunks: string[] = [];
    for await (const event of engine.generateReply({ annotationId: annotation.id })) {
      if (event.type === 'text') chunks.push(event.content);
    }

    expect(chunks.join('')).toBe('This explains it.');
    const messages = await annotations.listMessages(annotation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toBe('This explains it.');
    expect((await annotations.getById(annotation.id))!.status).toBe('answered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_annotations-replies.ts
```

Expected: FAIL with module not found for `../annotation-service`.

- [ ] **Step 3: Implement analysis annotation service**

Create `apps/desktop/src/main/services/code-analysis/annotation-service.ts` with methods:

```ts
import { randomUUID } from 'crypto';
import type { DatabaseClient } from '../../db/client';
import type { AnalysisAnnotation, AnalysisDiscussionMessage } from './types';

export interface CreateAnalysisAnnotationInput {
  analysisDocumentId: string;
  selectedText: string;
  question: string;
}

export class AnalysisAnnotationService {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: CreateAnalysisAnnotationInput): Promise<AnalysisAnnotation> {
    const doc = this.db.db.prepare('SELECT content_markdown AS contentMarkdown FROM analysis_documents WHERE id = ?')
      .get(input.analysisDocumentId) as { contentMarkdown: string } | undefined;
    if (!doc) throw new Error(`Analysis document not found: ${input.analysisDocumentId}`);

    const start = doc.contentMarkdown.indexOf(input.selectedText);
    if (start < 0) throw new Error('Selected text not found in analysis document');

    const end = start + input.selectedText.length;
    const id = randomUUID();
    const now = new Date().toISOString();
    const prefix = doc.contentMarkdown.substring(Math.max(0, start - 50), start);
    const suffix = doc.contentMarkdown.substring(end, end + 50);

    this.db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, input.analysisDocumentId, start, end, input.selectedText, prefix, suffix, input.question, now, now);

    await this.addMessage({ annotationId: id, role: 'user', content: input.question });
    const created = await this.getById(id);
    if (!created) throw new Error(`Analysis annotation not found after creation: ${id}`);
    return created;
  }

  async getById(id: string): Promise<AnalysisAnnotation | null> {
    const row = this.db.db.prepare(`
      SELECT id, analysis_document_id AS analysisDocumentId,
             anchor_start_offset AS anchorStartOffset, anchor_end_offset AS anchorEndOffset,
             anchor_exact_text AS anchorExactText, anchor_prefix AS anchorPrefix,
             anchor_suffix AS anchorSuffix, question, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_annotations WHERE id = ?
    `).get(id) as AnalysisAnnotation | undefined;
    return row ?? null;
  }

  async markStatus(id: string, status: AnalysisAnnotation['status']): Promise<void> {
    this.db.db.prepare('UPDATE analysis_annotations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }

  async listByDocument(analysisDocumentId: string): Promise<AnalysisAnnotation[]> {
    return this.db.db.prepare(`
      SELECT id, analysis_document_id AS analysisDocumentId,
             anchor_start_offset AS anchorStartOffset, anchor_end_offset AS anchorEndOffset,
             anchor_exact_text AS anchorExactText, anchor_prefix AS anchorPrefix,
             anchor_suffix AS anchorSuffix, question, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_annotations WHERE analysis_document_id = ?
      ORDER BY created_at ASC
    `).all(analysisDocumentId) as AnalysisAnnotation[];
  }

  async addMessage(input: { annotationId: string; role: 'user' | 'assistant'; content: string; modelId?: string }): Promise<AnalysisDiscussionMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.db.prepare(`
      INSERT INTO analysis_discussion_messages (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.annotationId, input.role, input.content, input.modelId ?? null, now);
    return { id, annotationId: input.annotationId, role: input.role, content: input.content, modelId: input.modelId, createdAt: now };
  }

  async listMessages(annotationId: string): Promise<AnalysisDiscussionMessage[]> {
    return this.db.db.prepare(`
      SELECT id, annotation_id AS annotationId, role, content, model_id AS modelId, created_at AS createdAt
      FROM analysis_discussion_messages
      WHERE annotation_id = ?
      ORDER BY created_at ASC
    `).all(annotationId) as AnalysisDiscussionMessage[];
  }
}
```

- [ ] **Step 4: Implement reply engine**

Create `apps/desktop/src/main/services/code-analysis/reply-engine.ts`:

```ts
import type { ChatMessage, LLMProvider } from '@ai-reader/core';
import type { DatabaseClient } from '../../db/client';
import type { AnalysisAnnotationService } from './annotation-service';

export type AnalysisReplyEvent =
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export class AnalysisReplyEngine {
  constructor(private readonly deps: {
    db: DatabaseClient;
    llm: LLMProvider;
    annotationService: AnalysisAnnotationService;
  }) {}

  async *generateReply(input: { annotationId: string }): AsyncIterable<AnalysisReplyEvent> {
    const annotation = await this.deps.annotationService.getById(input.annotationId);
    if (!annotation) {
      yield { type: 'error', error: `Analysis annotation not found: ${input.annotationId}` };
      return;
    }

    const document = this.deps.db.db.prepare(`
      SELECT goal, content_markdown AS contentMarkdown FROM analysis_documents WHERE id = ?
    `).get(annotation.analysisDocumentId) as { goal: string; contentMarkdown: string } | undefined;
    if (!document) {
      yield { type: 'error', error: `Analysis document not found: ${annotation.analysisDocumentId}` };
      return;
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You answer comments on a generated code analysis document. Use Markdown. Be concise and evidence-aware.',
      },
      {
        role: 'user',
        content: [
          `Original analysis goal: ${document.goal}`,
          '',
          `Selected text: ${annotation.anchorExactText}`,
          '',
          `User comment: ${annotation.question}`,
          '',
          'Analysis document excerpt:',
          document.contentMarkdown.slice(0, 5000),
        ].join('\n'),
      },
    ];

    let full = '';
    try {
      for await (const chunk of this.deps.llm.chatStream({ messages, temperature: 0.2 })) {
        if (chunk.done) break;
        if (chunk.delta) {
          full += chunk.delta;
          yield { type: 'text', content: chunk.delta };
        }
      }
      if (full) {
        await this.deps.annotationService.addMessage({
          annotationId: annotation.id,
          role: 'assistant',
          content: full,
          modelId: this.deps.llm.defaultModel,
        });
        await this.deps.annotationService.markStatus(annotation.id, 'answered');
      }
      yield { type: 'done' };
    } catch (err) {
      await this.deps.annotationService.markStatus(annotation.id, 'failed');
      yield { type: 'error', error: err instanceof Error ? err.message : 'Unknown reply error' };
    }
  }
}
```

- [ ] **Step 5: Update public exports**

Modify `apps/desktop/src/main/services/code-analysis/index.ts`:

```ts
export * from './types';
export * from './service';
export * from './tool-registry';
export * from './tool-loop';
export * from './annotation-service';
export * from './reply-engine';
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_annotations-replies.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/annotation-service.ts apps/desktop/src/main/services/code-analysis/reply-engine.ts apps/desktop/src/main/services/code-analysis/index.ts apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts
git commit -m "feat(code-analysis): add analysis comments and replies"
```

## Task 7: Export And Reimport

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/export-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_export-service.ts`

- [ ] **Step 1: Write failing export/import tests**

Create `apps/desktop/src/main/services/code-analysis/test/test_export-service.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { AnalysisExportService } from '../export-service';

describe('AnalysisExportService', () => {
  let db: DatabaseClient;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const now = new Date().toISOString();
    db.db.prepare(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES ('project-1', 'Fixture', '/secret/path', 'hash-1', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO analysis_documents
        (id, project_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
      VALUES ('doc-1', 'project-1', 'Explain startup', '# Startup\n\nUses IPC.', 'completed', 'mock', 1, ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES ('ann-1', 'doc-1', 2, 9, 'Startup', '# ', '', 'What starts?', 'answered', ?, ?)
    `).run(now, now);
    db.db.prepare(`
      INSERT INTO analysis_discussion_messages (id, annotation_id, role, content, model_id, created_at)
      VALUES ('msg-1', 'ann-1', 'assistant', 'The app starts in Electron main.', 'mock', ?)
    `).run(now);
  });

  afterEach(() => {
    db.close();
  });

  it('exports Markdown with comments and replies', async () => {
    const service = new AnalysisExportService(db);
    const markdown = await service.exportMarkdown('doc-1');
    expect(markdown).toContain('# Startup');
    expect(markdown).toContain('## Comments');
    expect(markdown).toContain('What starts?');
    expect(markdown).toContain('The app starts in Electron main.');
  });

  it('exports JSON without absolute source path and reimports state', async () => {
    const service = new AnalysisExportService(db);
    const exported = await service.exportJson('doc-1');
    expect(exported.type).toBe('code-analysis-document');
    expect(JSON.stringify(exported)).not.toContain('/secret/path');

    const targetDb = createDatabase(':memory:');
    try {
      const targetService = new AnalysisExportService(targetDb);
      const imported = await targetService.importJson(exported);
      expect(imported.contentMarkdown).toContain('# Startup');
      const restoredMessages = targetDb.db.prepare('SELECT COUNT(*) AS count FROM analysis_discussion_messages').get();
      expect(restoredMessages).toEqual({ count: 1 });
    } finally {
      targetDb.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_export-service.ts
```

Expected: FAIL with module not found for `../export-service`.

- [ ] **Step 3: Add export service**

Create `apps/desktop/src/main/services/code-analysis/export-service.ts` with methods `exportMarkdown(documentId)`, `exportJson(documentId)`, and `importJson(payload)`. The implementation must:

```ts
export interface AireaderCodeAnalysisExport {
  schemaVersion: 1;
  type: 'code-analysis-document';
  sourceDirectoryName: string;
  sourceDirectoryPathHash: string;
  analysisGoal: string;
  analysisMarkdown: string;
  toolTrace: Array<{ stepIndex: number; toolName: string; toolArgsJson: string; resultSummary: string }>;
  referencedFiles: string[];
  annotations: Array<{
    id: string;
    anchorStartOffset: number;
    anchorEndOffset: number;
    anchorExactText: string;
    anchorPrefix: string;
    anchorSuffix: string;
    question: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  discussionMessages: Array<{ annotationId: string; role: string; content: string; modelId?: string; createdAt: string }>;
  modelInfo: { modelId?: string };
  createdAt: string;
  exportedAt: string;
}
```

`exportMarkdown` must build:

```md
# <document goal>

<analysis markdown>

## Comments

### Comment 1

> <selected text>

Question: <question>

AI: <assistant message>
```

`importJson` must create a new `code_projects` row with an empty `root_path`, insert a new `analysis_documents` row, insert annotations, and map exported annotation ids to newly inserted message rows.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_export-service.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/export-service.ts apps/desktop/src/main/services/code-analysis/test/test_export-service.ts
git commit -m "feat(code-analysis): add annotated export import"
```

## Task 8: IPC And Preload API

**Files:**
- Modify: `packages/shared/src/ipc/channels.ts`
- Modify: `packages/shared/src/ipc/types.ts`
- Create: `apps/desktop/src/main/ipc/code-analysis.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/ipc/test_code-analysis.test.ts`

- [ ] **Step 1: Write failing IPC handler tests**

Create `apps/desktop/src/main/ipc/test_code-analysis.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@ai-reader/shared';
import { registerCodeAnalysisHandlers } from './code-analysis';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
}));

describe('code analysis IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers core code analysis channels', () => {
    registerCodeAnalysisHandlers({} as any);
    const channels = (ipcMain.handle as any).mock.calls.map((call: any[]) => call[0]);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_RUN);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION);
    expect(channels).toContain(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/ipc/test_code-analysis.test.ts
```

Expected: FAIL because channels and handler module do not exist.

- [ ] **Step 3: Add shared IPC constants and types**

Add these channel constants to `packages/shared/src/ipc/channels.ts`:

```ts
CODE_ANALYSIS_CREATE_PROJECT: 'codeAnalysis:createProject',
CODE_ANALYSIS_RUN: 'codeAnalysis:run',
CODE_ANALYSIS_GET_DOCUMENT: 'codeAnalysis:getDocument',
CODE_ANALYSIS_LIST_TRACES: 'codeAnalysis:listTraces',
CODE_ANALYSIS_CREATE_ANNOTATION: 'codeAnalysis:createAnnotation',
CODE_ANALYSIS_LIST_ANNOTATIONS: 'codeAnalysis:listAnnotations',
CODE_ANALYSIS_REPLY_TO_ANNOTATION: 'codeAnalysis:replyToAnnotation',
CODE_ANALYSIS_EXPORT_MARKDOWN: 'codeAnalysis:exportMarkdown',
CODE_ANALYSIS_EXPORT_JSON: 'codeAnalysis:exportJson',
CODE_ANALYSIS_IMPORT_JSON: 'codeAnalysis:importJson',
DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
```

Add matching payload/result interfaces to `packages/shared/src/ipc/types.ts`, using the field names from `types.ts` and export package from Task 7.

- [ ] **Step 4: Add IPC handlers**

Create `apps/desktop/src/main/ipc/code-analysis.ts` with `registerCodeAnalysisHandlers(deps)` registering each channel and returning `IPCResult<T>`. Use the same try/catch pattern from existing `apps/desktop/src/main/ipc/documents.ts`.

- [ ] **Step 5: Wire handlers and preload**

Modify `apps/desktop/src/main/ipc/index.ts` to create:

```ts
const codeAnalysisService = new CodeAnalysisService({ db, llm: llmProvider });
const analysisAnnotationService = new AnalysisAnnotationService(db);
const analysisReplyEngine = new AnalysisReplyEngine({ db, llm: llmProvider, annotationService: analysisAnnotationService });
const analysisExportService = new AnalysisExportService(db);
registerCodeAnalysisHandlers({
  codeAnalysisService,
  analysisAnnotationService,
  analysisReplyEngine,
  analysisExportService,
});
```

Modify `apps/desktop/src/preload/index.ts` to expose:

```ts
codeAnalysis: {
  createProject: (rootPath: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_CREATE_PROJECT, rootPath),
  run: (projectId: string, goal: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_RUN, { projectId, goal }),
  getDocument: (id: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_GET_DOCUMENT, id),
  listTraces: (documentId: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_LIST_TRACES, documentId),
  createAnnotation: (payload: unknown) => invoke(IPC_CHANNELS.CODE_ANALYSIS_CREATE_ANNOTATION, payload),
  listAnnotations: (documentId: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_LIST_ANNOTATIONS, documentId),
  replyToAnnotation: (annotationId: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_REPLY_TO_ANNOTATION, annotationId),
  exportMarkdown: (documentId: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_MARKDOWN, documentId),
  exportJson: (documentId: string) => invoke(IPC_CHANNELS.CODE_ANALYSIS_EXPORT_JSON, documentId),
  importJson: (payload: unknown) => invoke(IPC_CHANNELS.CODE_ANALYSIS_IMPORT_JSON, payload),
}
```

- [ ] **Step 6: Run IPC tests**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/ipc/test_code-analysis.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ipc/channels.ts packages/shared/src/ipc/types.ts apps/desktop/src/main/ipc/code-analysis.ts apps/desktop/src/main/ipc/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc/test_code-analysis.test.ts
git commit -m "feat(code-analysis): expose ipc api"
```

## Task 9: Renderer Workbench And Component Tests

**Files:**
- Create: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`
- Create: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css`
- Create: `apps/desktop/src/renderer/components/code-analysis/AnalysisPromptBox.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/ToolTraceTimeline.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/AnalysisMarkdownViewer.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/AnnotationSidebar.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/ExportMenu.tsx`
- Create: `apps/desktop/src/renderer/components/code-analysis/index.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: Write failing workbench component test**

Create `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CodeAnalysisWorkbench from '../CodeAnalysisWorkbench';

describe('CodeAnalysisWorkbench', () => {
  beforeEach(() => {
    (window as any).api = {
      codeAnalysis: {
        createProject: vi.fn(async () => ({ id: 'project-1', name: 'Fixture', rootPathHash: 'hash' })),
        run: vi.fn(async () => ({
          id: 'doc-1',
          projectId: 'project-1',
          goal: 'Explain startup',
          contentMarkdown: '# Startup\n\nUses IPC.',
          status: 'completed',
          toolCallCount: 1,
        })),
        listTraces: vi.fn(async () => [{ id: 'trace-1', toolName: 'listFiles', resultSummary: 'package.json' }]),
        createAnnotation: vi.fn(async () => ({
          id: 'ann-1',
          anchorExactText: 'Startup',
          question: 'Explain this',
          status: 'pending',
          createdAt: new Date().toISOString(),
        })),
        listAnnotations: vi.fn(async () => []),
      },
      dialog: {
        openDirectory: vi.fn(async () => ({ canceled: false, filePaths: ['E:/fixture'] })),
      },
    };
  });

  it('runs analysis from the bottom prompt and renders Markdown with trace status', async () => {
    const user = userEvent.setup();
    render(<CodeAnalysisWorkbench />);

    await user.click(screen.getByRole('button', { name: /select directory/i }));
    await user.type(screen.getByLabelText(/analysis goal/i), 'Explain startup');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('Startup')).toBeInTheDocument());
    expect(screen.getByText(/listFiles/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
```

Expected: FAIL with module not found for `../CodeAnalysisWorkbench`.

- [ ] **Step 3: Add minimal renderer components**

Implement:

- `AnalysisPromptBox`: textarea, `Enter` submits, `Shift+Enter` inserts newline, disabled state during run.
- `ToolTraceTimeline`: list of traces with tool name and summary.
- `AnalysisMarkdownViewer`: wraps existing `MarkdownRenderer` and forwards `onTextSelect`.
- `AnnotationSidebar`: wraps existing annotation/reply components with analysis labels.
- `ExportMenu`: buttons for Markdown and JSON export.
- `CodeAnalysisWorkbench`: orchestrates project selection, run analysis, render document, show traces.

The initial version should use existing `MarkdownRenderer`, `TextSelectionToolbar`, `AnnotationPanel`, and `AiReplyStream` instead of rewriting them.

- [ ] **Step 4: Add dark workbench CSS**

Create `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css` with stable three-column layout:

```css
.workbench {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 360px;
  grid-template-rows: 1fr auto;
  height: 100%;
  background: #0f172a;
  color: #f8fafc;
}

.leftPanel,
.rightPanel {
  min-width: 0;
  overflow: hidden;
  background: #0b1220;
  border-color: #334155;
}

.centerPanel {
  min-width: 0;
  overflow: auto;
  background: #0b1120;
}

.document {
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 40px 120px;
}

.promptBar {
  grid-column: 2;
  border-top: 1px solid #334155;
  background: #111827;
  padding: 12px 16px;
}
```

- [ ] **Step 5: Route App to workbench**

Modify `apps/desktop/src/renderer/App.tsx`:

```tsx
import CodeAnalysisWorkbench from './pages/CodeAnalysisWorkbench';

export default function App() {
  return <CodeAnalysisWorkbench />;
}
```

- [ ] **Step 6: Run renderer test**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css apps/desktop/src/renderer/components/code-analysis apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
git commit -m "feat(code-analysis): add analysis workbench ui"
```

## Task 10: Full Chain Verification And Coverage

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts`
- Modify tests from prior tasks only if failures expose real integration gaps.

- [ ] **Step 1: Write full-chain failing E2E test**

Create `apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts` that combines:

```ts
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LLMProvider, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from '@ai-reader/core';
import { createDatabase, type DatabaseClient } from '../../db/client';
import { CodeAnalysisService } from '../service';
import { AnalysisAnnotationService } from '../annotation-service';
import { AnalysisReplyEngine } from '../reply-engine';
import { AnalysisExportService } from '../export-service';

class E2ELLM implements LLMProvider {
  readonly name = 'mock';
  readonly defaultModel = 'mock-e2e';
  private chatCalls = 0;

  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.chatCalls += 1;
    const content = this.chatCalls === 1
      ? JSON.stringify({ tool: 'readFile', args: { path: 'package.json' } })
      : '# Project Analysis\n\nThe package is defined in `package.json`.';
    return {
      id: `chat-${this.chatCalls}`,
      content,
      model: this.defaultModel,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }

  async *chatStream(): AsyncIterable<ChatCompletionChunk> {
    yield { id: 'reply-1', delta: 'It refers to package metadata.', done: false };
    yield { id: 'reply-2', delta: '', done: true, finishReason: 'stop' };
  }

  async validateApiKey(): Promise<boolean> {
    return true;
  }
}

describe('code-analysis full chain', () => {
  let db: DatabaseClient;
  let root: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    root = mkdtempSync(join(tmpdir(), 'ai-reader-e2e-'));
    writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n');
  });

  afterEach(() => {
    db.close();
  });

  it('runs analysis, comments, replies, exports, and reimports', async () => {
    const llm = new E2ELLM();
    const analysis = new CodeAnalysisService({ db, llm });
    const annotations = new AnalysisAnnotationService(db);
    const replies = new AnalysisReplyEngine({ db, llm, annotationService: annotations });
    const exports = new AnalysisExportService(db);

    const project = await analysis.createProject(root);
    const doc = await analysis.runAnalysis({ projectId: project.id, goal: 'Analyze package metadata' });
    expect(doc.contentMarkdown).toContain('# Project Analysis');

    const annotation = await annotations.create({
      analysisDocumentId: doc.id,
      selectedText: 'package.json',
      question: 'What is this file?',
    });

    for await (const _event of replies.generateReply({ annotationId: annotation.id })) {}

    const markdown = await exports.exportMarkdown(doc.id);
    const json = await exports.exportJson(doc.id);
    expect(markdown).toContain('What is this file?');
    expect(json.annotations).toHaveLength(1);

    const restoredDb = createDatabase(':memory:');
    try {
      const restored = new AnalysisExportService(restoredDb);
      const restoredDoc = await restored.importJson(json);
      expect(restoredDoc.contentMarkdown).toContain('# Project Analysis');
      expect(restoredDb.db.prepare('SELECT COUNT(*) AS count FROM analysis_annotations').get()).toEqual({ count: 1 });
    } finally {
      restoredDb.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes after prior tasks**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_e2e-flow.ts
```

Expected: PASS. If it fails, fix the integration point exposed by this test.

- [ ] **Step 3: Run all code-analysis tests**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx src/main/ipc/test_code-analysis.test.ts
```

Expected: all code-analysis tests pass.

- [ ] **Step 4: Run package tests and coverage**

Run:

```bash
pnpm --filter @ai-reader/desktop test -- --coverage
```

Expected: code-analysis service files are covered by unit and integration tests. If unrelated legacy tests fail, list them separately and do not mark the MVP fully complete.

- [ ] **Step 5: Run full workspace tests**

Run:

```bash
pnpm test
```

Expected: all tests pass. If legacy failures remain from the pre-MVP baseline, report exact failing files and keep the code-analysis MVP status as blocked on legacy test cleanup.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts
git commit -m "test(code-analysis): cover full mvp flow"
```

## Self-Review

Spec coverage:

- Code directory selection: Task 8 IPC, Task 9 UI.
- Arbitrary user analysis goal: Task 3 prompt builder, Task 5 service, Task 9 prompt UI.
- Autonomous read-only tool calls: Task 2 tools, Task 4 loop.
- Default 15 tool-call budget: Task 3 context, Task 4 loop, Task 5 service.
- Markdown analysis document: Task 4 loop, Task 5 persistence, Task 9 UI.
- Tool trace visibility and persistence: Task 5 persistence, Task 9 timeline.
- Feishu-like comments: Task 6 services, Task 9 UI.
- Automatic AI replies: Task 6 reply engine.
- Markdown and JSON export/reimport: Task 7 service.
- No write tools or shell execution: Task 2 read-only tools, Task 4 loop.
- Current project reuse: Task 8 uses IPC pattern; Task 9 reuses existing Markdown/selection/reply components.

Completeness scan:

- The plan defines concrete files, commands, expected outcomes, and test-first sequencing for each task.

Type consistency:

- Domain field names follow `apps/desktop/src/main/services/code-analysis/types.ts`.
- Database column names follow the schema in Task 1.
- IPC names are under `CODE_ANALYSIS_*` and `DIALOG_OPEN_DIRECTORY`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-28-code-analysis-harness-mvp.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Choose one before implementation starts.
