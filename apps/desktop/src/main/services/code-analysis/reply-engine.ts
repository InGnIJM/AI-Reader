import type { ChatMessage, LLMProvider } from '@ai-reader/core';
import type { AppLanguage } from '@ai-reader/shared';

import type { DatabaseClient } from '../../db/client';
import type { SettingsService } from '../settings-service';
import type { AnalysisAnnotationService } from './annotation-service';

export type AnalysisReplyEvent =
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export function buildAnalysisReplyMessages(input: {
  goal: string;
  selectedText: string;
  question: string;
  contentMarkdown: string;
  outputLanguage: AppLanguage;
  projectName?: string;
  discussionHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): ChatMessage[] {
  const languageInstruction =
    input.outputLanguage === 'en-US'
      ? 'Write the answer in English unless the user explicitly requests another language.'
      : 'Write the answer in Simplified Chinese unless the user explicitly requests another language.';

  const systemLines = [
    'You answer comments on a generated code analysis document. Use Markdown.',
    'Be concise and evidence-aware.',
    languageInstruction,
  ];
  if (input.projectName) {
    systemLines.push(`Project: ${input.projectName}`);
  }

  const userLines: string[] = [];

  // Include ordered discussion history before the current question
  if (input.discussionHistory && input.discussionHistory.length > 0) {
    userLines.push('Discussion history:');
    for (const msg of input.discussionHistory) {
      userLines.push(`[${msg.role}]: ${msg.content}`);
    }
    userLines.push('');
  }

  userLines.push(`Original analysis goal: ${input.goal}`, '');
  userLines.push(`Selected text: ${input.selectedText}`, '');
  userLines.push(`User comment: ${input.question}`, '');
  userLines.push('Analysis document excerpt:');
  userLines.push(input.contentMarkdown.slice(0, 5000));

  return [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: userLines.join('\n') },
  ];
}

export class AnalysisReplyEngine {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      llm: LLMProvider;
      annotationService: AnalysisAnnotationService;
      settings?: Pick<SettingsService, 'getLanguage'>;
    },
  ) {}

  async *generateReply(input: { annotationId: string }): AsyncIterable<AnalysisReplyEvent> {
    const annotation = await this.deps.annotationService.getById(input.annotationId);
    if (!annotation) {
      yield { type: 'error', error: `Analysis annotation not found: ${input.annotationId}` };
      return;
    }

    // Fetch document joined through session to get project metadata
    const document = this.deps.db.db
      .prepare(
        `
      SELECT d.goal,
             d.content_markdown AS contentMarkdown,
             p.name AS projectName
      FROM analysis_documents d
      LEFT JOIN analysis_sessions s ON d.session_id = s.id
      LEFT JOIN code_projects p ON s.project_id = p.id
      WHERE d.id = ?
    `,
      )
      .get(annotation.analysisDocumentId) as {
        goal: string;
        contentMarkdown: string;
        projectName: string | null;
      } | undefined;
    if (!document) {
      yield { type: 'error', error: `Analysis document not found: ${annotation.analysisDocumentId}` };
      return;
    }

    // Fetch ordered discussion history for this annotation
    const discussionHistory = await this.deps.annotationService.listMessages(annotation.id);

    const messages = buildAnalysisReplyMessages({
      goal: document.goal,
      selectedText: annotation.selectedText || annotation.anchorExactText,
      question: annotation.question,
      contentMarkdown: document.contentMarkdown,
      outputLanguage: this.deps.settings?.getLanguage() ?? 'zh-CN',
      projectName: document.projectName ?? undefined,
      discussionHistory: discussionHistory.map((m) => ({ role: m.role, content: m.content })),
    });

    let full = '';
    try {
      for await (const chunk of this.deps.llm.chatStream({ messages, temperature: 0.2 })) {
        if (chunk.done) break;
        if (chunk.delta) {
          full += chunk.delta;
          yield { type: 'text', content: chunk.delta };
        }
      }

      if (full.trim()) {
        await this.deps.annotationService.addMessage({
          annotationId: annotation.id,
          role: 'assistant',
          content: full,
          modelId: this.deps.llm.defaultModel,
        });
        await this.deps.annotationService.markStatus(annotation.id, 'answered');
      } else {
        await this.deps.annotationService.markStatus(annotation.id, 'failed');
        yield { type: 'error', error: 'The model returned an empty reply.' };
        return;
      }
      yield { type: 'done' };
    } catch (err) {
      await this.deps.annotationService.markStatus(annotation.id, 'failed');
      yield { type: 'error', error: err instanceof Error ? err.message : 'Unknown reply error' };
    }
  }
}
