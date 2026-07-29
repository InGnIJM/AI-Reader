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

export function buildLocalDocumentMessages(input: {
  goal: string;
  outputLanguage?: AppLanguage;
}): ChatMessage[] {
  const languageInstruction =
    input.outputLanguage === 'en-US'
      ? 'Write in English unless the user explicitly requests another language.'
      : 'Write in Simplified Chinese unless the user explicitly requests another language.';
  return [
    {
      role: 'system',
      content: [
        'You create self-contained Markdown documents inside AI-Reader.',
        'No project directory is attached and no file tools are available.',
        'Do not claim to have read local files or paths.',
        languageInstruction,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '## Document Request',
        input.goal,
        '',
        '## Output Contract',
        'Return the complete Markdown document only.',
        'Clearly label uncertainty when the request lacks required source material.',
      ].join('\n'),
    },
  ];
}

export function buildMultiTurnMessages(input: {
  goal: string;
  projectContext: string;
  traceSummary: string;
  conversationHistory?: ChatMessage[];
  outputLanguage?: AppLanguage;
}): ChatMessage[] {
  const languageInstruction =
    input.outputLanguage === 'en-US'
      ? 'Write the final answer in English unless the user explicitly requests another language.'
      : 'Write the final answer in Simplified Chinese unless the user explicitly requests another language.';

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are continuing an analysis conversation. Previous turns are provided for context.',
        'You are a read-only code analysis assistant inside AI-Reader.',
        'You may request read-only tools when evidence is missing.',
        'Never modify files, never run shell commands, and never claim evidence you did not inspect.',
        languageInstruction,
      ].join('\n'),
    },
  ];

  // Insert conversation history if provided
  if (input.conversationHistory) {
    messages.push(...input.conversationHistory);
  }

  // Current goal with project context and trace
  messages.push({
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
  });

  return messages;
}
