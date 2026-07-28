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
    expect(messages.map((message) => message.content).join('\n')).toContain('read-only');
    expect(messages.map((message) => message.content).join('\n')).toContain('Explain startup flow');
    expect(messages.map((message) => message.content).join('\n')).toContain('Markdown');
  });
});
