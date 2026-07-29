import type { ChatMessage } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

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

export function buildMultiTurnContext(input: {
  turns: Array<{ goal: string; contentMarkdown: string }>;
  currentGoal: string;
  projectContext?: string;
  maxHistoryChars?: number;
  outputLanguage?: AppLanguage;
}): ChatMessage[] {
  const maxHistoryChars = input.maxHistoryChars ?? 60000;
  const hasProject = !!input.projectContext;

  const languageInstruction =
    input.outputLanguage === 'en-US'
      ? 'Write the final answer in English unless the user explicitly requests another language.'
      : 'Write the final answer in Simplified Chinese unless the user explicitly requests another language.';

  // Build system message
  const systemParts: string[] = [
    'You are a read-only code analysis assistant inside AI-Reader.',
    'You may request read-only tools when evidence is missing.',
    'Never modify files, never run shell commands, and never claim evidence you did not inspect.',
    languageInstruction,
  ];

  if (hasProject) {
    systemParts.push(
      '',
      input.projectContext!,
      '',
      'Available read-only tools:',
      '- listFiles(path?, depth?)',
      '- readFile(path, startLine?, endLine?)',
      '- searchText(query, path?, maxResults?)',
    );
  }

  // Collect history from newest to oldest, respecting budget
  const includedTurns: Array<{ goal: string; contentMarkdown: string }> = [];
  let usedChars = 0;
  let trimmed = false;

  for (let i = input.turns.length - 1; i >= 0; i--) {
    const turn = input.turns[i];
    const turnChars = turn.goal.length + turn.contentMarkdown.length;
    if (usedChars + turnChars > maxHistoryChars && includedTurns.length > 0) {
      trimmed = true;
      break;
    }
    includedTurns.unshift(turn);
    usedChars += turnChars;
  }

  if (includedTurns.length < input.turns.length) {
    trimmed = true;
  }

  if (trimmed) {
    systemParts.push('', '较早回合因上下文预算被省略');
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
  ];

  // Add history as user/assistant pairs
  for (const turn of includedTurns) {
    messages.push({ role: 'user', content: turn.goal });
    messages.push({ role: 'assistant', content: turn.contentMarkdown });
  }

  // Add current goal
  messages.push({ role: 'user', content: input.currentGoal });

  return messages;
}
