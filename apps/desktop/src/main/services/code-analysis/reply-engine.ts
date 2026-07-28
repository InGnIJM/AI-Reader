import type { ChatMessage, LLMProvider } from '@ai-reader/core';

import type { DatabaseClient } from '../../db/client';
import type { AnalysisAnnotationService } from './annotation-service';

export type AnalysisReplyEvent =
  | { type: 'text'; content: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export class AnalysisReplyEngine {
  constructor(
    private readonly deps: {
      db: DatabaseClient;
      llm: LLMProvider;
      annotationService: AnalysisAnnotationService;
    },
  ) {}

  async *generateReply(input: { annotationId: string }): AsyncIterable<AnalysisReplyEvent> {
    const annotation = await this.deps.annotationService.getById(input.annotationId);
    if (!annotation) {
      yield { type: 'error', error: `Analysis annotation not found: ${input.annotationId}` };
      return;
    }

    const document = this.deps.db.db
      .prepare(
        `
      SELECT goal, content_markdown AS contentMarkdown FROM analysis_documents WHERE id = ?
    `,
      )
      .get(annotation.analysisDocumentId) as { goal: string; contentMarkdown: string } | undefined;
    if (!document) {
      yield { type: 'error', error: `Analysis document not found: ${annotation.analysisDocumentId}` };
      return;
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You answer comments on a generated code analysis document. Use Markdown. Be concise and evidence-aware.',
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
