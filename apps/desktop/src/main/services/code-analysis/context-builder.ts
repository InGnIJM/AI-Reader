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
