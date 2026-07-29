import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { DatabaseClient } from '../../db/client';
import type { AnalysisDocument } from './types';

export interface AireaderCodeAnalysisExport {
  schemaVersion: 1;
  type: 'code-analysis-document';
  sessionId: string;
  sessionTitle: string;
  sourceDirectoryName: string;
  sourceDirectoryPathHash: string;
  analysisGoal: string;
  analysisMarkdown: string;
  toolTrace: Array<{ stepIndex: number; toolName: string; toolArgsJson: string; resultSummary: string }>;
  referencedFiles: string[];
  annotations: Array<{
    id: string;
    anchorStartOffset: number;
    anchorEndOffset: number;
    anchorExactText: string;
    anchorPrefix: string;
    anchorSuffix: string;
    question: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  discussionMessages: Array<{
    annotationId: string;
    role: string;
    content: string;
    modelId?: string;
    createdAt: string;
  }>;
  modelInfo: { modelId?: string };
  createdAt: string;
  exportedAt: string;
}

interface ExportDocumentRow {
  id: string;
  goal: string;
  contentMarkdown: string;
  modelId?: string;
  createdAt: string;
  sessionId: string;
  sessionTitle: string;
  projectName: string | null;
  rootPathHash: string | null;
}

export class AnalysisExportService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly localDocumentsPath?: string,
  ) {}

  async exportMarkdown(documentId: string): Promise<string> {
    const document = this.getExportDocument(documentId);
    const annotations = this.listAnnotations(documentId);
    const sections = [`# ${document.sessionTitle}`, '', `## ${document.goal}`, '', document.contentMarkdown, '', '## Comments'];

    annotations.forEach((annotation, index) => {
      const messages = this.listMessages(annotation.id);
      sections.push('', `### Comment ${index + 1}`, '', `> ${annotation.anchorExactText}`, '');
      sections.push(`Question: ${annotation.question}`);
      for (const message of messages) {
        if (message.role === 'assistant') sections.push('', `AI: ${message.content}`);
      }
    });

    return sections.join('\n');
  }

  async exportJson(documentId: string): Promise<AireaderCodeAnalysisExport> {
    const document = this.getExportDocument(documentId);
    const annotations = this.listAnnotations(documentId);
    const discussionMessages = annotations.flatMap((annotation) =>
      this.listMessages(annotation.id).map((message) => ({
        annotationId: message.annotationId,
        role: message.role,
        content: message.content,
        modelId: message.modelId,
        createdAt: message.createdAt,
      })),
    );

    return {
      schemaVersion: 1,
      type: 'code-analysis-document',
      sessionId: document.sessionId,
      sessionTitle: document.sessionTitle,
      sourceDirectoryName: document.projectName ?? 'No Project',
      sourceDirectoryPathHash: document.rootPathHash ?? '',
      analysisGoal: document.goal,
      analysisMarkdown: document.contentMarkdown,
      toolTrace: this.listToolTrace(documentId),
      referencedFiles: this.extractReferencedFiles(document.contentMarkdown),
      annotations,
      discussionMessages,
      modelInfo: { modelId: document.modelId },
      createdAt: document.createdAt,
      exportedAt: new Date().toISOString(),
    };
  }

  async importJson(payload: AireaderCodeAnalysisExport): Promise<AnalysisDocument> {
    if (payload.schemaVersion !== 1 || payload.type !== 'code-analysis-document') {
      throw new Error('Unsupported code analysis export payload');
    }

    const now = new Date().toISOString();
    const documentId = randomUUID();
    const sessionId = randomUUID();
    const branchId = randomUUID();

    // Create session + branch + turn in one transaction
    this.db.db.exec('BEGIN IMMEDIATE');
    try {
      // 1. Create session (active pointers set after document exists)
      this.db.db
        .prepare(
          `INSERT INTO analysis_sessions
            (id, project_id, title, status, active_branch_id, active_document_id, created_at, updated_at)
           VALUES (?, NULL, ?, 'active', NULL, NULL, ?, ?)`,
        )
        .run(sessionId, payload.sessionTitle ?? 'Imported Session', now, now);

      // 2. Create main branch (head_document_id set after document exists)
      this.db.db
        .prepare(
          `INSERT INTO analysis_branches
            (id, session_id, name, parent_branch_id, forked_from_document_id, head_document_id, created_at, updated_at)
           VALUES (?, ?, '主分支', NULL, NULL, NULL, ?, ?)`,
        )
        .run(branchId, sessionId, now, now);

      // 3. Create the turn (document)
      this.db.db
        .prepare(
          `INSERT INTO analysis_documents
            (id, session_id, branch_id, goal, content_markdown, status, model_id, tool_call_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
        )
        .run(
          documentId,
          sessionId,
          branchId,
          payload.analysisGoal,
          payload.analysisMarkdown,
          payload.modelInfo.modelId ?? null,
          payload.toolTrace.length,
          payload.createdAt,
          now,
        );

      // 4. Update branch head
      this.db.db
        .prepare('UPDATE analysis_branches SET head_document_id = ?, updated_at = ? WHERE id = ?')
        .run(documentId, now, branchId);

      // 5. Update session active pointers
      this.db.db
        .prepare(
          'UPDATE analysis_sessions SET active_branch_id = ?, active_document_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(branchId, documentId, now, sessionId);

      this.db.db.exec('COMMIT');
    } catch (error) {
      if (this.db.db.inTransaction) this.db.db.exec('ROLLBACK');
      throw error;
    }

    const annotationIdMap = new Map<string, string>();
    const annotationInsert = this.db.db.prepare(`
      INSERT INTO analysis_annotations
        (id, analysis_document_id, anchor_start_offset, anchor_end_offset, anchor_exact_text,
         anchor_prefix, anchor_suffix, question, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const annotation of payload.annotations) {
      const newId = randomUUID();
      annotationIdMap.set(annotation.id, newId);
      annotationInsert.run(
        newId,
        documentId,
        annotation.anchorStartOffset,
        annotation.anchorEndOffset,
        annotation.anchorExactText,
        annotation.anchorPrefix,
        annotation.anchorSuffix,
        annotation.question,
        annotation.status,
        annotation.createdAt,
        annotation.updatedAt,
      );
    }

    const traceInsert = this.db.db.prepare(`
      INSERT INTO analysis_tool_traces
        (id, analysis_document_id, step_index, tool_name, tool_args_json, result_summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const trace of payload.toolTrace) {
      traceInsert.run(
        randomUUID(),
        documentId,
        trace.stepIndex,
        trace.toolName,
        trace.toolArgsJson,
        trace.resultSummary,
        now,
      );
    }

    const messageInsert = this.db.db.prepare(`
      INSERT INTO analysis_discussion_messages (id, annotation_id, role, content, model_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const message of payload.discussionMessages) {
      const annotationId = annotationIdMap.get(message.annotationId);
      if (!annotationId) continue;
      messageInsert.run(
        randomUUID(),
        annotationId,
        message.role,
        message.content,
        message.modelId ?? null,
        message.createdAt,
      );
    }

    const row = this.db.db
      .prepare(
        `
      SELECT id, goal, content_markdown AS contentMarkdown,
             status, model_id AS modelId, tool_call_count AS toolCallCount,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_documents WHERE id = ?
    `,
      )
      .get(documentId) as AnalysisDocument | undefined;
    if (!row) throw new Error(`Imported analysis document not found: ${documentId}`);
    if (this.localDocumentsPath?.trim()) {
      const outputDirectory = join(this.localDocumentsPath, documentId);
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(join(outputDirectory, 'document.md'), row.contentMarkdown, 'utf8');
    }
    return row;
  }

  private getExportDocument(documentId: string): ExportDocumentRow {
    const row = this.db.db
      .prepare(
        `
      SELECT d.id, d.goal, d.content_markdown AS contentMarkdown, d.model_id AS modelId,
             d.created_at AS createdAt,
             s.id AS sessionId, s.title AS sessionTitle,
             p.name AS projectName, p.root_path_hash AS rootPathHash
      FROM analysis_documents d
      LEFT JOIN analysis_sessions s ON s.id = d.session_id
      LEFT JOIN code_projects p ON p.id = s.project_id
      WHERE d.id = ?
    `,
      )
      .get(documentId) as ExportDocumentRow | undefined;
    if (!row) throw new Error(`Analysis document not found: ${documentId}`);
    return row;
  }

  private listAnnotations(documentId: string): AireaderCodeAnalysisExport['annotations'] {
    return this.db.db
      .prepare(
        `
      SELECT id, anchor_start_offset AS anchorStartOffset, anchor_end_offset AS anchorEndOffset,
             anchor_exact_text AS anchorExactText, anchor_prefix AS anchorPrefix,
             anchor_suffix AS anchorSuffix, question, status,
             created_at AS createdAt, updated_at AS updatedAt
      FROM analysis_annotations
      WHERE analysis_document_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(documentId) as AireaderCodeAnalysisExport['annotations'];
  }

  private listMessages(annotationId: string): AireaderCodeAnalysisExport['discussionMessages'] {
    return this.db.db
      .prepare(
        `
      SELECT annotation_id AS annotationId, role, content, model_id AS modelId, created_at AS createdAt
      FROM analysis_discussion_messages
      WHERE annotation_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(annotationId) as AireaderCodeAnalysisExport['discussionMessages'];
  }

  private listToolTrace(documentId: string): AireaderCodeAnalysisExport['toolTrace'] {
    return this.db.db
      .prepare(
        `
      SELECT step_index AS stepIndex, tool_name AS toolName, tool_args_json AS toolArgsJson,
             result_summary AS resultSummary
      FROM analysis_tool_traces
      WHERE analysis_document_id = ?
      ORDER BY step_index ASC
    `,
      )
      .all(documentId) as AireaderCodeAnalysisExport['toolTrace'];
  }

  private extractReferencedFiles(markdown: string): string[] {
    return Array.from(markdown.matchAll(/`([^`\n]+\.[A-Za-z0-9]+)`/g), (match) => match[1]).sort();
  }
}
