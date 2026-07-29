import type { ChatMessage } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

export interface BuildAnalysisMessagesInput {
  goal: string;
  projectContext: string;
  traceSummary: string;
  outputLanguage?: AppLanguage;
}

export function buildAnalysisMessages(input: BuildAnalysisMessagesInput): ChatMessage[] {
  const languageInstruction =
    input.outputLanguage === 'en-US'
      ? 'Write the final answer in English unless the user explicitly requests another language.'
      : 'Write the final answer in Simplified Chinese unless the user explicitly requests another language.';
  return [
    {
      role: 'system',
      content: [
        'You are a read-only code analysis assistant inside AI-Reader.',
        'You may request read-only tools when evidence is missing.',
        'Never modify files, never run shell commands, and never claim evidence you did not inspect.',
        languageInstruction,
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
