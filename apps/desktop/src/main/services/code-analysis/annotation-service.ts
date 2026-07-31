import { randomUUID } from 'crypto';

import { createLogger } from '@ai-reader/shared';
import type { DatabaseClient } from '../../db/client';
import type { AnalysisAnnotation, AnalysisDiscussionMessage } from './types';

const log = createLogger('annotation');

export interface CreateAnalysisAnnotationInput {
  analysisDocumentId: string;
  selectedText: string;
  question: string;
  sourceStartOffset?: number;
  sourceEndOffset?: number;
}

export class AnalysisAnnotationService {
  constructor(private readonly db: DatabaseClient) {}

  async create(input: CreateAnalysisAnnotationInput): Promise<AnalysisAnnotation> {
    const doc = this.db.db
      .prepare('SELECT content_markdown AS contentMarkdown FROM analysis_documents WHERE id = ?')
      .get(input.analysisDocumentId) as { contentMarkdown: string } | undefined;
    if (!doc) throw new Error(`Analysis document not found: ${input.analysisDocumentId}`);

    const hasSourceOffsets =
      typeof input.sourceStartOffset === 'number' &&
      typeof input.sourceEndOffset === 'number';
    const start = hasSourceOffsets
      ? input.sourceStartOffset!
      : doc.contentMarkdown.indexOf(input.selectedText);
    const end = hasSourceOffsets ? input.sourceEndOffset! : start + input.selectedText.length;
    if (hasSourceOffsets) {
      // Source offsets must be finite integers within bounds, and the extracted
      // text must match the selection once Markdown inline syntax is stripped
      // (the renderer shows plain text while the source keeps `**`, backticks,
      // link syntax). This rejects NaN/invalid offsets and anchors that would
      // point at different text while accepting selections spanning formatting.
      const stripMarkdown = (value: string) =>
        value
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/__([^_]+)__/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]*)`/g, '$1');
      const normalize = (value: string) =>
        stripMarkdown(value).replace(/\s+/g, ' ').trim();
      const isValid =
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end <= doc.contentMarkdown.length &&
        start < end &&
        normalize(doc.contentMarkdown.substring(start, end)) === normalize(input.selectedText);
      if (!isValid) {
        log.warn(
          `createAnnotation: invalid source offsets. ` +
            `selectedText=${JSON.stringify(input.selectedText)} start=${start} end=${end} ` +
            `contentLength=${doc.contentMarkdown.length} ` +
            `actual=${JSON.stringify(normalize(doc.contentMarkdown.substring(start, end)))} ` +
            `selected=${JSON.stringify(normalize(input.selectedText))}`,
        );
        throw new Error('Selected text offsets are invalid');
      }
    } else if (start < 0) {
      throw new Error('Selected text not found in analysis document');
    }
    const anchorExactText = doc.contentMarkdown.substring(start, end);
    const id = randomUUID();
    const now = new Date().toISOString();
    const prefix = doc.contentMarkdown.substring(Math.max(0, start - 50), start);
    const suffix = doc.contentMarkdown.substring(end, end + 50);

    this.db.db
      .prepare(
        `
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         selected_text, anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `,
      )
      .run(
        id,
        input.analysisDocumentId,
        start,
        end,
        anchorExactText,
        input.selectedText,
        prefix,
        suffix,
        input.question,
        now,
        now,
      );

    await this.addMessage({ annotationId: id, role: 'user', content: input.question });
    const created = await this.getById(id);
    if (!created) throw new Error(`Analysis annotation not found after creation: ${id}`);
    return created;
  }

  async getById(id: string): Promise<AnalysisAnnotation | null> {
    const row = this.db.db
      .prepare(
        `
      SELECT id, analysis_document_id AS analysisDocumentId,
             anchor_start_offset AS anchorStartOffset, anchor_end_offset AS anchorEndOffset,
             anchor_exact_text AS anchorExactText, selected_text AS selectedText,
             anchor_prefix AS anchorPrefix,
             anchor_suffix AS anchorSuffix, question, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_annotations WHERE id = ?
    `,
      )
      .get(id) as AnalysisAnnotation | undefined;
    return row ?? null;
  }

  async markStatus(id: string, status: AnalysisAnnotation['status']): Promise<void> {
    this.db.db
      .prepare('UPDATE analysis_annotations SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }

  async listByDocument(analysisDocumentId: string): Promise<AnalysisAnnotation[]> {
    return this.db.db
      .prepare(
        `
      SELECT id, analysis_document_id AS analysisDocumentId,
             anchor_start_offset AS anchorStartOffset, anchor_end_offset AS anchorEndOffset,
             anchor_exact_text AS anchorExactText, selected_text AS selectedText,
             anchor_prefix AS anchorPrefix,
             anchor_suffix AS anchorSuffix, question, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_annotations WHERE analysis_document_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(analysisDocumentId) as AnalysisAnnotation[];
  }

  async addMessage(input: {
    annotationId: string;
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
  }): Promise<AnalysisDiscussionMessage> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.db
      .prepare(
        `
      INSERT INTO analysis_discussion_messages (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(id, input.annotationId, input.role, input.content, input.modelId ?? null, now);
    return {
      id,
      annotationId: input.annotationId,
      role: input.role,
      content: input.content,
      modelId: input.modelId,
      createdAt: now,
    };
  }

  async listMessages(annotationId: string): Promise<AnalysisDiscussionMessage[]> {
    return this.db.db
      .prepare(
        `
      SELECT id, annotation_id AS annotationId, role, content, model_id AS modelId, created_at AS createdAt
      FROM analysis_discussion_messages
      WHERE annotation_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(annotationId) as AnalysisDiscussionMessage[];
  }
}
