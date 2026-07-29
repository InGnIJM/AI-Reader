import { describe, expect, it, vi } from 'vitest';
import { buildProjectContext, summarizeToolResult } from '../context-builder';
import { buildAnalysisMessages } from '../prompt-builder';
import { AnalysisReplyEngine, buildAnalysisReplyMessages } from '../reply-engine';

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

  it('instructs analysis and annotation replies to use the saved output language', () => {
    const analysisMessages = buildAnalysisMessages({
      goal: 'Explain startup flow',
      projectContext: 'Project context here',
      traceSummary: 'No tools used yet',
      outputLanguage: 'zh-CN',
    });
    const replyMessages = buildAnalysisReplyMessages({
      goal: 'Explain startup flow',
      selectedText: 'main process',
      question: 'What does this mean?',
      contentMarkdown: '# Startup',
      outputLanguage: 'en-US',
    });

    expect(analysisMessages[0].content).toContain('Simplified Chinese');
    expect(replyMessages[0].content).toContain('English');
  });

  it('marks an annotation failed when the model returns an empty reply', async () => {
    const annotationService = {
      getById: async () => ({
        id: 'annotation-1',
        analysisDocumentId: 'document-1',
        anchorExactText: 'pnpm',
        question: 'Explain this',
      }),
      addMessage: vi.fn(),
      markStatus: vi.fn(async () => undefined),
    };
    const engine = new AnalysisReplyEngine({
      db: {
        db: {
          prepare: () => ({
            get: () => ({ goal: 'Explain pnpm', contentMarkdown: '# pnpm' }),
          }),
        },
      } as any,
      llm: {
        defaultModel: 'mock-model',
        async *chatStream() {
          yield { id: 'done', delta: '', done: true };
        },
      } as any,
      annotationService: annotationService as any,
    });

    const events = [];
    for await (const event of engine.generateReply({ annotationId: 'annotation-1' })) {
      events.push(event);
    }

    expect(events).toContainEqual({ type: 'error', error: 'The model returned an empty reply.' });
    expect(annotationService.markStatus).toHaveBeenCalledWith('annotation-1', 'failed');
    expect(annotationService.addMessage).not.toHaveBeenCalled();
  });
});
