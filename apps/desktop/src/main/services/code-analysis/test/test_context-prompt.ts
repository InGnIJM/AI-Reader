import { describe, expect, it, vi } from 'vitest';
import { buildMultiTurnContext, buildProjectContext, summarizeToolResult } from '../context-builder';
import { buildAnalysisMessages, buildLocalDocumentMessages, buildMultiTurnMessages } from '../prompt-builder';
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

  it('builds a projectless document prompt without directory access', () => {
    const messages = buildLocalDocumentMessages({
      goal: 'Write a pnpm guide',
      outputLanguage: 'en-US',
    });
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Write a pnpm guide');
    expect(prompt).toContain('no file tools are available');
    expect(prompt).toContain('complete Markdown document only');
    expect(prompt).toContain('Write in English');
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
      listMessages: vi.fn(async () => []),
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

describe('buildMultiTurnContext', () => {
  it('orders messages: system -> user/assistant pairs -> current goal', () => {
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Explain entry point', contentMarkdown: '# Entry point\nThe app starts here.' },
        { goal: 'Explain IPC layer', contentMarkdown: '# IPC Layer\nMessages flow through IPC.' },
      ],
      currentGoal: 'Explain the full startup sequence',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Explain entry point');
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toContain('Entry point');
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toContain('Explain IPC layer');
    expect(messages[4].role).toBe('assistant');
    expect(messages[4].content).toContain('IPC Layer');
    expect(messages[5].role).toBe('user');
    expect(messages[5].content).toContain('Explain the full startup sequence');
  });

  it('includes project context only in the system message', () => {
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Goal A', contentMarkdown: '# A\nContent A' },
      ],
      currentGoal: 'Goal B',
      projectContext: 'Project: TestApp\nRoot path hash: abc123',
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Project: TestApp');
    expect(messages[0].content).toContain('Root path hash: abc123');

    // Non-system messages should not contain project context
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].content).not.toContain('Root path hash');
    }
  });

  it('omits directory tools when no project context is provided', () => {
    const withProject = buildMultiTurnContext({
      turns: [],
      currentGoal: 'Analyze the codebase',
      projectContext: 'Project: TestApp',
    });
    const withoutProject = buildMultiTurnContext({
      turns: [],
      currentGoal: 'Analyze the codebase',
    });

    expect(withProject[0].content).toContain('listFiles');
    expect(withProject[0].content).toContain('readFile');
    expect(withProject[0].content).toContain('searchText');

    expect(withoutProject[0].content).not.toContain('listFiles');
    expect(withoutProject[0].content).not.toContain('readFile');
    expect(withoutProject[0].content).not.toContain('searchText');
  });

  it('excludes sibling branch content: only provided turns appear', () => {
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Current branch goal', contentMarkdown: '# Current branch\nContent here.' },
      ],
      currentGoal: 'Continue analysis',
    });

    // Only 1 turn pair + system + current goal = 4 messages
    const userMessages = messages.filter((m) => m.role === 'user');
    const assistantMessages = messages.filter((m) => m.role === 'assistant');

    expect(userMessages).toHaveLength(2); // 1 turn goal + 1 current goal
    expect(assistantMessages).toHaveLength(1); // 1 turn response
    expect(messages[1].content).toContain('Current branch goal');
  });

  it('trims oldest complete turns when history exceeds 60K char budget', () => {
    const bigContent = 'X'.repeat(25000);
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Old turn', contentMarkdown: bigContent },
        { goal: 'Middle turn', contentMarkdown: bigContent },
        { goal: 'New turn', contentMarkdown: bigContent },
      ],
      currentGoal: 'Continue',
    });

    // 25K * 2 (goal+content per turn) = 50K per turn pair
    // With 60K budget, the oldest turn should be trimmed
    // Newest turns should be kept
    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUserBeforeGoal = userMessages[userMessages.length - 2];

    expect(lastUserBeforeGoal.content).toContain('New turn');
    expect(messages[messages.length - 1].content).toContain('Continue');
  });

  it('adds omission marker when trimming history turns', () => {
    const bigContent = 'Y'.repeat(25000);
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Old turn', contentMarkdown: bigContent },
        { goal: 'Middle turn', contentMarkdown: bigContent },
        { goal: 'New turn', contentMarkdown: bigContent },
      ],
      currentGoal: 'Continue',
    });

    const systemMessage = messages[0].content;
    // If trimming happened, the marker should appear
    const hasOmission = systemMessage.includes('较早回合因上下文预算被省略');
    const allUserContents = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const keptOldTurn = allUserContents.includes('Old turn');

    // Either kept all (no trimming) or has the marker
    if (!keptOldTurn) {
      expect(hasOmission).toBe(true);
    }
  });

  it('never truncates the system message or current goal input', () => {
    const bigProjectContext = 'A'.repeat(30000);
    const bigGoal = 'B'.repeat(10000);
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Turn 1', contentMarkdown: 'C'.repeat(25000) },
        { goal: 'Turn 2', contentMarkdown: 'D'.repeat(25000) },
      ],
      currentGoal: bigGoal,
      projectContext: bigProjectContext,
    });

    // System message should be complete (not truncated)
    expect(messages[0].content).toContain(bigProjectContext);

    // Current goal should be complete (not truncated)
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toContain(bigGoal);
  });

  it('defaults maxHistoryChars to 60000', () => {
    // A single turn of ~500 chars should always be kept with default budget
    const messages = buildMultiTurnContext({
      turns: [
        { goal: 'Small goal', contentMarkdown: 'Small content' },
      ],
      currentGoal: 'Continue',
    });

    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages[0].content).toContain('Small goal');
  });
});

describe('buildMultiTurnMessages', () => {
  it('includes conversation history between system and current goal', () => {
    const messages = buildMultiTurnMessages({
      goal: 'Explain the full architecture',
      projectContext: 'Project: AI-Reader',
      traceSummary: 'readFile(src/main.ts)',
      conversationHistory: [
        { role: 'user', content: 'What is the entry point?' },
        { role: 'assistant', content: 'The entry point is src/main.ts' },
      ],
    });

    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('continuing an analysis conversation');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('What is the entry point?');
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].content).toContain('src/main.ts');
    expect(messages[3].role).toBe('user');
    expect(messages[3].content).toContain('Explain the full architecture');
    expect(messages[3].content).toContain('readFile(src/main.ts)');
  });

  it('works without conversation history', () => {
    const messages = buildMultiTurnMessages({
      goal: 'First question',
      projectContext: 'Project: Test',
      traceSummary: 'No tools used yet',
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('First question');
  });

  it('applies output language instruction', () => {
    const enMessages = buildMultiTurnMessages({
      goal: 'Test',
      projectContext: 'P',
      traceSummary: 'T',
      outputLanguage: 'en-US',
    });
    const zhMessages = buildMultiTurnMessages({
      goal: 'Test',
      projectContext: 'P',
      traceSummary: 'T',
      outputLanguage: 'zh-CN',
    });

    expect(enMessages[0].content).toContain('English');
    expect(zhMessages[0].content).toContain('Simplified Chinese');
  });
});
