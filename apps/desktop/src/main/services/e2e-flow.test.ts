import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type DatabaseClient } from '../db/client';
import { WorkspaceService } from './workspace/index';
import { DocumentImportService } from './document-import/index';
import { AnnotationService } from './annotation/index';
import { DiscussionService } from './discussion/index';

/**
 * End-to-end integration test: full flow through the services.
 *
 * Flow: create workspace -> import document -> (simulate AI generation) -> create annotation -> add discussion
 *
 * This test verifies that all services work together correctly on a shared
 * in-memory SQLite database, with foreign key constraints respected.
 */
describe('E2E: Workspace -> Document -> Annotation -> Discussion', () => {
  let db: DatabaseClient;
  let workspaceService: WorkspaceService;
  let documentService: DocumentImportService;
  let annotationService: AnnotationService;
  let discussionService: DiscussionService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    workspaceService = new WorkspaceService(db);
    documentService = new DocumentImportService(db);
    annotationService = new AnnotationService(db);
    discussionService = new DiscussionService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should complete the full workflow: workspace -> document -> annotation -> discussion', async () => {
    // ── Step 1: Create workspace ────────────────────────────────────────
    const workspace = await workspaceService.create(
      'AI Learning',
      'My AI learning workspace',
    );
    expect(workspace.id).toBeDefined();
    expect(workspace.name).toBe('AI Learning');

    // Verify workspace persisted
    const foundWs = await workspaceService.getById(workspace.id);
    expect(foundWs).not.toBeNull();
    expect(foundWs!.name).toBe('AI Learning');

    // ── Step 2: Import document ─────────────────────────────────────────
    const markdownContent = `# Chapter 1: Introduction

This is an introduction to machine learning concepts.

# Chapter 2: Neural Networks

Neural networks are composed of layers of neurons that process information.

# Chapter 3: Training

Training involves adjusting weights to minimize loss.`;

    const importResult = await documentService.importFromContent(
      workspace.id,
      'machine-learning.md',
      markdownContent,
    );

    expect(importResult.document.id).toBeDefined();
    expect(importResult.document.fileName).toBe('machine-learning.md');
    expect(importResult.document.fileType).toBe('markdown');
    expect(importResult.document.status).toBe('ready');
    expect(importResult.chapters).toHaveLength(3);
    expect(importResult.chapters[0].title).toBe('Chapter 1: Introduction');
    expect(importResult.chapters[1].title).toBe('Chapter 2: Neural Networks');
    expect(importResult.chapters[2].title).toBe('Chapter 3: Training');

    // Verify document persisted and linked to workspace
    const docDetail = await documentService.getById(importResult.document.id);
    expect(docDetail).not.toBeNull();
    expect(docDetail!.workspaceId).toBe(workspace.id);
    expect(docDetail!.chapters).toHaveLength(3);

    // Verify document appears in workspace listing
    const docsInWorkspace = await documentService.listByWorkspace(workspace.id);
    expect(docsInWorkspace).toHaveLength(1);
    expect(docsInWorkspace[0].id).toBe(importResult.document.id);

    // ── Step 3: Simulate AI generation (insert generated_article + generated_section) ──
    // In real flow, ArticleGenerator + GenerationJobService would create these.
    // For E2E test, we insert them directly to bridge document -> annotation.
    const now = new Date().toISOString();
    const articleId = 'art-e2e-1';
    const sectionId = 'sec-e2e-1';
    const sectionContent =
      '# Neural Networks\n\nNeural networks are composed of layers of neurons that process information. ' +
      'Each layer transforms the input data through weighted connections.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        articleId,
        importResult.document.id,
        'Machine Learning Study Guide',
        'completed',
        now,
        now,
      );

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sectionId,
        articleId,
        0,
        'Neural Networks Overview',
        JSON.stringify([importResult.chapters[1].id]),
        sectionContent,
        'completed',
        now,
        now,
      );

    // ── Step 4: Create annotation ───────────────────────────────────────
    const selectedText = 'layers of neurons';
    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText,
      type: 'note',
      content: 'Key concept: neurons are the basic building blocks.',
    });

    expect(annotation.id).toBeDefined();
    expect(annotation.articleId).toBe(articleId);
    expect(annotation.sectionId).toBe(sectionId);
    expect(annotation.anchorExactText).toBe(selectedText);
    expect(annotation.type).toBe('note');
    expect(annotation.content).toBe('Key concept: neurons are the basic building blocks.');
    expect(annotation.anchorStartOffset).toBeGreaterThanOrEqual(0);
    expect(annotation.anchorEndOffset).toBe(
      annotation.anchorStartOffset + selectedText.length,
    );

    // Verify annotation persisted and retrievable
    const foundAnnotation = await annotationService.getById(annotation.id);
    expect(foundAnnotation).not.toBeNull();
    expect(foundAnnotation!.anchorExactText).toBe(selectedText);

    // Verify annotation appears in section listing
    const sectionAnnotations = await annotationService.listBySection(sectionId);
    expect(sectionAnnotations).toHaveLength(1);
    expect(sectionAnnotations[0].id).toBe(annotation.id);

    // Verify annotation appears in article listing
    const articleAnnotations = await annotationService.listByArticle(articleId);
    expect(articleAnnotations).toHaveLength(1);
    expect(articleAnnotations[0].id).toBe(annotation.id);

    // ── Step 5: Add discussion messages ─────────────────────────────────
    const userMessage = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'What exactly are layers in neural networks?',
    });

    expect(userMessage.id).toBeDefined();
    expect(userMessage.annotationId).toBe(annotation.id);
    expect(userMessage.role).toBe('user');
    expect(userMessage.content).toBe(
      'What exactly are layers in neural networks?',
    );

    const assistantMessage = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content:
        'Layers are collections of neurons that process inputs at a specific level of abstraction. ' +
        'Common types include input, hidden, and output layers.',
      modelId: 'gpt-4o-mini',
      tokenUsage: { input: 120, output: 80 },
    });

    expect(assistantMessage.id).toBeDefined();
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.modelId).toBe('gpt-4o-mini');
    expect(assistantMessage.tokenUsage).toBe('{"input":120,"output":80}');

    // Verify messages persisted and ordered chronologically
    const messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('What exactly are layers in neural networks?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('Layers are collections of neurons');
    expect(messages[1].modelId).toBe('gpt-4o-mini');

    // Verify individual message retrieval
    const foundMsg = await discussionService.getById(userMessage.id);
    expect(foundMsg).not.toBeNull();
    expect(foundMsg!.content).toBe('What exactly are layers in neural networks?');
  });

  it('should support multiple annotations on different sections with separate discussions', async () => {
    // Create workspace + import document
    const workspace = await workspaceService.create('Multi-Annotation WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'multi.md',
      '# Part A\n\nContent about topic A.\n\n# Part B\n\nContent about topic B.',
    );

    // Simulate AI generation with two sections
    const now = new Date().toISOString();
    const articleId = 'art-multi';
    const secA = 'sec-a';
    const secB = 'sec-b';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Multi Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(secA, articleId, 0, 'Part A', '[]', 'Content about topic A.', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(secB, articleId, 1, 'Part B', '[]', 'Content about topic B.', 'completed', now, now);

    // Create annotations on different sections
    const annA = await annotationService.create({
      articleId,
      sectionId: secA,
      selectedText: 'topic A',
      type: 'highlight',
    });
    const annB = await annotationService.create({
      articleId,
      sectionId: secB,
      selectedText: 'topic B',
      type: 'question',
      content: 'What is topic B about?',
    });

    // Add discussions to each annotation
    await discussionService.addMessage({
      annotationId: annA.id,
      role: 'user',
      content: 'Tell me more about A',
    });
    await discussionService.addMessage({
      annotationId: annB.id,
      role: 'user',
      content: 'Explain B',
    });
    await discussionService.addMessage({
      annotationId: annB.id,
      role: 'assistant',
      content: 'B is about...',
    });

    // Verify isolation
    const msgsA = await discussionService.listByAnnotation(annA.id);
    const msgsB = await discussionService.listByAnnotation(annB.id);

    expect(msgsA).toHaveLength(1);
    expect(msgsA[0].content).toBe('Tell me more about A');
    expect(msgsB).toHaveLength(2);
    expect(msgsB[0].content).toBe('Explain B');
    expect(msgsB[1].content).toBe('B is about...');

    // Verify article-level annotation listing
    const allAnnotations = await annotationService.listByArticle(articleId);
    expect(allAnnotations).toHaveLength(2);
  });

  it('should cascade delete discussions when annotation is deleted', async () => {
    // Setup: workspace -> document -> generated data -> annotation -> discussion
    const workspace = await workspaceService.create('Cascade WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'cascade.md',
      '# Title\n\nSome content here.',
    );

    const now = new Date().toISOString();
    const articleId = 'art-cascade';
    const sectionId = 'sec-cascade';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Cascade Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', 'Some content here.', 'completed', now, now);

    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'content',
      type: 'note',
      content: 'Important note',
    });

    await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'Question?',
    });
    await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content: 'Answer.',
    });

    // Verify messages exist
    let messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(2);

    // Delete annotation -> discussion messages should cascade delete
    await annotationService.delete(annotation.id);

    const foundAnnotation = await annotationService.getById(annotation.id);
    expect(foundAnnotation).toBeNull();

    messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(0);
  });

  it('should cascade delete documents and downstream data when workspace is deleted', async () => {
    // This tests the FK cascade: workspace -> document -> chapters
    // (annotations/discussions are on generated_articles/sections, not directly on workspace)
    const workspace = await workspaceService.create('WS for Delete');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'temp.md',
      '# Temp\n\nTemp content.',
    );

    const docId = importResult.document.id;

    // Verify document exists
    const docBefore = await documentService.getById(docId);
    expect(docBefore).not.toBeNull();

    // Delete workspace -> documents cascade
    db.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspace.id);

    const docAfter = await documentService.getById(docId);
    expect(docAfter).toBeNull();

    // Chapters should also be gone
    const chapters = db.db
      .prepare('SELECT * FROM chapters WHERE document_id = ?')
      .all(docId);
    expect(chapters).toHaveLength(0);
  });

  it('should support the complete flow with multiple documents in the same workspace', async () => {
    const workspace = await workspaceService.create('Multi-Doc WS');

    // Import two documents
    const doc1 = await documentService.importFromContent(
      workspace.id,
      'python.md',
      '# Python Basics\n\nVariables and types.',
    );
    const doc2 = await documentService.importFromContent(
      workspace.id,
      'javascript.md',
      '# JavaScript Basics\n\nClosures and prototypes.',
    );

    // Both should appear in workspace listing
    const docs = await documentService.listByWorkspace(workspace.id);
    expect(docs).toHaveLength(2);
    const docIds = docs.map((d) => d.id);
    expect(docIds).toContain(doc1.document.id);
    expect(docIds).toContain(doc2.document.id);

    // Each document should be independently retrievable
    const detail1 = await documentService.getById(doc1.document.id);
    const detail2 = await documentService.getById(doc2.document.id);
    expect(detail1!.fileName).toBe('python.md');
    expect(detail2!.fileName).toBe('javascript.md');
    expect(detail1!.workspaceId).toBe(workspace.id);
    expect(detail2!.workspaceId).toBe(workspace.id);
  });

  it('should handle annotation on text at the beginning of section content', async () => {
    const workspace = await workspaceService.create('Anchor WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'anchor.md',
      '# Title\n\nFirst sentence of the section.',
    );

    const now = new Date().toISOString();
    const articleId = 'art-anchor';
    const sectionId = 'sec-anchor';
    const sectionContent = 'First sentence of the section.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Anchor Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', sectionContent, 'completed', now, now);

    // Annotate text at the very beginning
    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'First sentence',
      type: 'highlight',
    });

    expect(annotation.anchorStartOffset).toBe(0);
    expect(annotation.anchorEndOffset).toBe('First sentence'.length);
    expect(annotation.anchorPrefix).toBe(''); // No prefix before position 0
    expect(annotation.anchorSuffix).toBe(' of the section.');
  });

  it('should handle annotation on text at the end of section content', async () => {
    const workspace = await workspaceService.create('Suffix WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'suffix.md',
      '# Title\n\nEnd marker.',
    );

    const now = new Date().toISOString();
    const articleId = 'art-suffix';
    const sectionId = 'sec-suffix';
    const sectionContent = 'Some text before. End marker.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Suffix Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', sectionContent, 'completed', now, now);

    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'End marker.',
      type: 'note',
      content: 'Last part',
    });

    expect(annotation.anchorSuffix).toBe(''); // No suffix at the end
    expect(annotation.anchorPrefix).toBe('Some text before. ');
  });

  // ── Additional E2E integration tests ────────────────────────────────────

  it('should complete the full flow with a txt document', async () => {
    const workspace = await workspaceService.create('TXT Workspace');

    const importResult = await documentService.importFromContent(
      workspace.id,
      'plain-notes.txt',
      'Machine learning is a subset of artificial intelligence. It focuses on building systems that learn from data.',
    );

    expect(importResult.document.fileType).toBe('txt');
    expect(importResult.chapters).toHaveLength(1);

    // Simulate AI generation
    const now = new Date().toISOString();
    const articleId = 'art-txt-e2e';
    const sectionId = 'sec-txt-e2e';
    const sectionContent = 'Machine learning is a powerful subset of artificial intelligence that focuses on building systems capable of learning from data.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'ML Overview', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'ML Overview', JSON.stringify([importResult.chapters[0].id]), sectionContent, 'completed', now, now);

    // Create annotation of type highlight
    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'artificial intelligence',
      type: 'highlight',
    });

    expect(annotation.type).toBe('highlight');
    expect(annotation.anchorExactText).toBe('artificial intelligence');
    expect(annotation.content).toBeUndefined();

    // Add discussion
    const msg = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'How does ML relate to deep learning?',
    });

    expect(msg.role).toBe('user');

    const reply = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content: 'Deep learning is a subset of machine learning that uses neural networks with many layers.',
      modelId: 'gpt-4o',
      tokenUsage: { input: 200, output: 150 },
    });

    expect(reply.modelId).toBe('gpt-4o');

    // Verify full conversation
    const messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('should support all three annotation types (note, question, highlight) on the same section', async () => {
    const workspace = await workspaceService.create('Annotation Types WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'types.md',
      '# Types\n\nNeural networks process data through layers of interconnected nodes.',
    );

    const now = new Date().toISOString();
    const articleId = 'art-types';
    const sectionId = 'sec-types';
    const sectionContent = 'Neural networks process data through layers of interconnected nodes. Each node applies a weighted transformation.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Types Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', sectionContent, 'completed', now, now);

    // Create all three types
    const note = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'Neural networks',
      type: 'note',
      content: 'Core concept to remember.',
    });

    const question = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'weighted transformation',
      type: 'question',
      content: 'What kind of transformation exactly?',
    });

    const highlight = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'interconnected nodes',
      type: 'highlight',
    });

    expect(note.type).toBe('note');
    expect(note.content).toBe('Core concept to remember.');
    expect(question.type).toBe('question');
    expect(question.content).toBe('What kind of transformation exactly?');
    expect(highlight.type).toBe('highlight');
    expect(highlight.content).toBeUndefined();

    // All three should be listed
    const allAnnotations = await annotationService.listBySection(sectionId);
    expect(allAnnotations).toHaveLength(3);

    // Each should have correct anchor
    expect(note.anchorStartOffset).toBe(0);
    expect(question.anchorExactText).toBe('weighted transformation');
    expect(highlight.anchorExactText).toBe('interconnected nodes');

    // Add discussion to each type
    await discussionService.addMessage({ annotationId: note.id, role: 'user', content: 'Note question' });
    await discussionService.addMessage({ annotationId: question.id, role: 'user', content: 'Follow-up on question' });
    await discussionService.addMessage({ annotationId: highlight.id, role: 'user', content: 'Highlight question' });

    // Verify isolation
    const noteMsgs = await discussionService.listByAnnotation(note.id);
    const questionMsgs = await discussionService.listByAnnotation(question.id);
    const highlightMsgs = await discussionService.listByAnnotation(highlight.id);

    expect(noteMsgs).toHaveLength(1);
    expect(questionMsgs).toHaveLength(1);
    expect(highlightMsgs).toHaveLength(1);
  });

  it('should support multi-turn discussion thread on a single annotation', async () => {
    const workspace = await workspaceService.create('Multi-Turn WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'multi-turn.md',
      '# Chapter\n\nTransformers use self-attention mechanisms to process sequences.',
    );

    const now = new Date().toISOString();
    const articleId = 'art-multiturn';
    const sectionId = 'sec-multiturn';
    const sectionContent = 'Transformers use self-attention mechanisms to process sequences in parallel.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Transformer Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', sectionContent, 'completed', now, now);

    const annotation = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'self-attention',
      type: 'question',
      content: 'How does self-attention work?',
    });

    // Multi-turn conversation: user -> assistant -> user follow-up -> assistant follow-up
    const m1 = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'How does self-attention work?',
    });
    const m2 = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content: 'Self-attention computes attention scores between all positions in a sequence.',
      modelId: 'gpt-4o',
      tokenUsage: { input: 50, output: 40 },
    });
    const m3 = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'Can you give a concrete example?',
    });
    const m4 = await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'assistant',
      content: 'Consider the sentence "The cat sat on the mat". Self-attention lets each word attend to all other words.',
      modelId: 'gpt-4o',
      tokenUsage: { input: 120, output: 90 },
    });

    // Verify all 4 messages are in order
    const messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(4);
    expect(messages[0].id).toBe(m1.id);
    expect(messages[0].role).toBe('user');
    expect(messages[1].id).toBe(m2.id);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].modelId).toBe('gpt-4o');
    expect(messages[2].id).toBe(m3.id);
    expect(messages[2].role).toBe('user');
    expect(messages[3].id).toBe(m4.id);
    expect(messages[3].role).toBe('assistant');
    expect(messages[3].content).toContain('The cat sat on the mat');

    // Verify token usage preserved
    expect(messages[1].tokenUsage).toBe('{"input":50,"output":40}');
    expect(messages[3].tokenUsage).toBe('{"input":120,"output":90}');
  });

  it('should maintain strict data isolation between workspaces', async () => {
    // Create two independent workspaces
    const ws1 = await workspaceService.create('Workspace A');
    const ws2 = await workspaceService.create('Workspace B');

    // Import documents into each
    const doc1 = await documentService.importFromContent(
      ws1.id,
      'doc-a.md',
      '# Topic A\n\nContent about topic A.',
    );
    const doc2 = await documentService.importFromContent(
      ws2.id,
      'doc-b.md',
      '# Topic B\n\nContent about topic B.',
    );

    // Generate articles in each workspace
    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-a', doc1.document.id, 'Article A', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-b', doc2.document.id, 'Article B', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-a', 'art-a', 0, 'Section A', '[]', 'Content about topic A.', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-b', 'art-b', 0, 'Section B', '[]', 'Content about topic B.', 'completed', now, now);

    // Create annotations in each workspace
    const annA = await annotationService.create({
      articleId: 'art-a',
      sectionId: 'sec-a',
      selectedText: 'topic A',
      type: 'note',
      content: 'Note in workspace A',
    });
    const annB = await annotationService.create({
      articleId: 'art-b',
      sectionId: 'sec-b',
      selectedText: 'topic B',
      type: 'note',
      content: 'Note in workspace B',
    });

    // Add discussions
    await discussionService.addMessage({ annotationId: annA.id, role: 'user', content: 'Question in A' });
    await discussionService.addMessage({ annotationId: annB.id, role: 'user', content: 'Question in B' });

    // Verify strict isolation: workspace A's data should not leak to B
    const docsA = await documentService.listByWorkspace(ws1.id);
    const docsB = await documentService.listByWorkspace(ws2.id);
    expect(docsA).toHaveLength(1);
    expect(docsA[0].fileName).toBe('doc-a.md');
    expect(docsB).toHaveLength(1);
    expect(docsB[0].fileName).toBe('doc-b.md');

    const annsA = await annotationService.listByArticle('art-a');
    const annsB = await annotationService.listByArticle('art-b');
    expect(annsA).toHaveLength(1);
    expect(annsA[0].anchorExactText).toBe('topic A');
    expect(annsB).toHaveLength(1);
    expect(annsB[0].anchorExactText).toBe('topic B');

    const msgsA = await discussionService.listByAnnotation(annA.id);
    const msgsB = await discussionService.listByAnnotation(annB.id);
    expect(msgsA).toHaveLength(1);
    expect(msgsA[0].content).toBe('Question in A');
    expect(msgsB).toHaveLength(1);
    expect(msgsB[0].content).toBe('Question in B');

    // Deleting workspace A should not affect workspace B
    db.db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws1.id);

    const docsAAfter = await documentService.listByWorkspace(ws1.id);
    const docsBAfter = await documentService.listByWorkspace(ws2.id);
    expect(docsAAfter).toHaveLength(0);
    expect(docsBAfter).toHaveLength(1);
  });

  it('should integrate generation job lifecycle with the full flow', async () => {
    // Import the GenerationJobService for this test
    const { GenerationJobService } = await import('./generation-job/index');
    const jobService = new GenerationJobService(db);

    const workspace = await workspaceService.create('Job Lifecycle WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'job-doc.md',
      '# Part 1\n\nContent one.\n\n# Part 2\n\nContent two.\n\n# Part 3\n\nContent three.',
    );

    expect(importResult.chapters).toHaveLength(3);

    // Create a generation job
    const job = await jobService.create({
      documentId: importResult.document.id,
      totalSections: 3,
    });
    expect(job.status).toBe('pending');
    expect(job.totalSections).toBe(3);
    expect(job.completedSections).toBe(0);

    // Start the job
    const runningJob = await jobService.start(job.id);
    expect(runningJob!.status).toBe('running');

    // Simulate progress updates
    await jobService.updateProgress(job.id, 1);
    await jobService.updateProgress(job.id, 2);
    await jobService.updateProgress(job.id, 3);

    const progressedJob = await jobService.getById(job.id);
    expect(progressedJob!.completedSections).toBe(3);

    // Mark completed
    const completedJob = await jobService.markCompleted(job.id);
    expect(completedJob!.status).toBe('completed');

    // Now simulate what happens after generation: insert generated data
    const now = new Date().toISOString();
    const articleId = 'art-job-lifecycle';
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Job Lifecycle Guide', 'completed', now, now);

    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-job-1', articleId, 0, 'Part 1', '[]', 'Content one.', 'completed', now, now);

    // Create annotation and discussion on generated content
    const annotation = await annotationService.create({
      articleId,
      sectionId: 'sec-job-1',
      selectedText: 'Content one',
      type: 'note',
    });

    await discussionService.addMessage({
      annotationId: annotation.id,
      role: 'user',
      content: 'Tell me more about Part 1',
    });

    const msgs = await discussionService.listByAnnotation(annotation.id);
    expect(msgs).toHaveLength(1);

    // Verify job is linked to document
    const jobs = await jobService.listByDocument(importResult.document.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job.id);
  });

  it('should propagate errors correctly through the service chain', async () => {
    const workspace = await workspaceService.create('Error Propagation WS');

    // Annotation on non-existent section should fail
    await expect(
      annotationService.create({
        articleId: 'non-existent-article',
        sectionId: 'non-existent-section',
        selectedText: 'text',
        type: 'note',
      }),
    ).rejects.toThrow('Section not found');

    // Discussion on non-existent annotation should fail (FK constraint)
    await expect(
      discussionService.addMessage({
        annotationId: 'non-existent-annotation',
        role: 'user',
        content: 'This should fail',
      }),
    ).rejects.toThrow();

    // Import with unsupported format should fail
    await expect(
      documentService.importFromContent(workspace.id, 'file.docx', 'content'),
    ).rejects.toThrow('Unsupported file format');

    // Annotation with text not in section should fail
    const importResult = await documentService.importFromContent(
      workspace.id,
      'error-test.md',
      '# Title\n\nSome actual content.',
    );

    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-error', importResult.document.id, 'Error Article', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-error', 'art-error', 0, 'Section', '[]', 'Some actual content.', 'completed', now, now);

    await expect(
      annotationService.create({
        articleId: 'art-error',
        sectionId: 'sec-error',
        selectedText: 'This text does not exist in the section content',
        type: 'note',
      }),
    ).rejects.toThrow('Selected text not found in section content');
  });

  it('should handle annotation anchors correctly with unicode and special characters', async () => {
    const workspace = await workspaceService.create('Unicode WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'unicode.md',
      '# Unicode\n\nThis section contains C++ code and special chars like <html> & "quotes".',
    );

    const now = new Date().toISOString();
    const articleId = 'art-unicode';
    const sectionId = 'sec-unicode';
    const sectionContent = 'This section contains C++ code and special chars like <html> & "quotes". Also emoji support.';

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Unicode Guide', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sectionId, articleId, 0, 'Section', '[]', sectionContent, 'completed', now, now);

    // Annotate text with special characters
    const ann1 = await annotationService.create({
      articleId,
      sectionId,
      selectedText: 'C++',
      type: 'note',
      content: 'Programming language',
    });
    expect(ann1.anchorExactText).toBe('C++');
    expect(ann1.anchorStartOffset).toBe(sectionContent.indexOf('C++'));

    const ann2 = await annotationService.create({
      articleId,
      sectionId,
      selectedText: '<html>',
      type: 'highlight',
    });
    expect(ann2.anchorExactText).toBe('<html>');

    const ann3 = await annotationService.create({
      articleId,
      sectionId,
      selectedText: '"quotes"',
      type: 'question',
      content: 'What kind of quotes?',
    });
    expect(ann3.anchorExactText).toBe('"quotes"');

    // Verify all annotations retrievable
    const all = await annotationService.listBySection(sectionId);
    expect(all).toHaveLength(3);

    // Add discussion with special characters
    await discussionService.addMessage({
      annotationId: ann1.id,
      role: 'user',
      content: 'What does C++ offer over C?',
    });
    await discussionService.addMessage({
      annotationId: ann1.id,
      role: 'assistant',
      content: 'C++ offers classes, templates, RAII, and the STL among other features.',
    });

    const msgs = await discussionService.listByAnnotation(ann1.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toContain('RAII');
  });

  it('should handle a document with many chapters and annotations across them', async () => {
    const workspace = await workspaceService.create('Many Chapters WS');

    // Build a markdown document with 10 chapters
    const chapters = Array.from({ length: 10 }, (_, i) => `# Chapter ${i + 1}\n\nContent for chapter ${i + 1}.`);
    const markdownContent = chapters.join('\n\n');

    const importResult = await documentService.importFromContent(
      workspace.id,
      'many-chapters.md',
      markdownContent,
    );

    expect(importResult.chapters).toHaveLength(10);

    // Simulate AI generation
    const now = new Date().toISOString();
    const articleId = 'art-many';
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(articleId, importResult.document.id, 'Many Chapters Guide', 'completed', now, now);

    const sectionIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const sectionId = `sec-many-${i}`;
      sectionIds.push(sectionId);
      db.db
        .prepare(
          `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sectionId,
          articleId,
          i,
          `Section ${i + 1}`,
          JSON.stringify([importResult.chapters[i].id]),
          `Content for section ${i + 1}.`,
          'completed',
          now,
          now,
        );
    }

    // Create one annotation per section
    for (let i = 0; i < 10; i++) {
      await annotationService.create({
        articleId,
        sectionId: sectionIds[i],
        selectedText: `section ${i + 1}`,
        type: 'note',
        content: `Note for section ${i + 1}`,
      });
    }

    // Verify all annotations at article level
    const articleAnnotations = await annotationService.listByArticle(articleId);
    expect(articleAnnotations).toHaveLength(10);

    // Verify each section has exactly 1 annotation
    for (const sectionId of sectionIds) {
      const sectionAnns = await annotationService.listBySection(sectionId);
      expect(sectionAnns).toHaveLength(1);
    }

    // Add discussions to a few annotations
    await discussionService.addMessage({ annotationId: articleAnnotations[0].id, role: 'user', content: 'Q about section 1' });
    await discussionService.addMessage({ annotationId: articleAnnotations[5].id, role: 'user', content: 'Q about section 6' });
    await discussionService.addMessage({ annotationId: articleAnnotations[9].id, role: 'user', content: 'Q about section 10' });

    // Verify discussions are correctly scoped
    const msgs0 = await discussionService.listByAnnotation(articleAnnotations[0].id);
    const msgs5 = await discussionService.listByAnnotation(articleAnnotations[5].id);
    const msgs9 = await discussionService.listByAnnotation(articleAnnotations[9].id);

    expect(msgs0).toHaveLength(1);
    expect(msgs5).toHaveLength(1);
    expect(msgs9).toHaveLength(1);

    // Deleting one annotation should not affect others
    await annotationService.delete(articleAnnotations[3].id);
    const remaining = await annotationService.listByArticle(articleId);
    expect(remaining).toHaveLength(9);
  });

  it('should reflect the complete state after full workflow in workspace listing', async () => {
    // Create multiple workspaces with different states
    const ws1 = await workspaceService.create('Active Workspace');
    const ws2 = await workspaceService.create('Archived Workspace');

    // Import documents into ws1
    const doc1 = await documentService.importFromContent(
      ws1.id,
      'active-doc.md',
      '# Active\n\nActive content.',
    );
    const doc2 = await documentService.importFromContent(
      ws1.id,
      'another-doc.txt',
      'Another document content.',
    );

    // Import document into ws2
    await documentService.importFromContent(
      ws2.id,
      'archived-doc.md',
      '# Archived\n\nArchived content.',
    );

    // Create annotation + discussion in ws1
    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-active', doc1.document.id, 'Active Article', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-active', 'art-active', 0, 'Section', '[]', 'Active content.', 'completed', now, now);

    const annotation = await annotationService.create({
      articleId: 'art-active',
      sectionId: 'sec-active',
      selectedText: 'Active content',
      type: 'note',
      content: 'Important',
    });
    await discussionService.addMessage({ annotationId: annotation.id, role: 'user', content: 'Question' });
    await discussionService.addMessage({ annotationId: annotation.id, role: 'assistant', content: 'Answer', modelId: 'gpt-4o' });

    // Verify workspace listing
    const allWorkspaces = await workspaceService.list();
    expect(allWorkspaces).toHaveLength(2);

    // Verify ws1 state
    const ws1Docs = await documentService.listByWorkspace(ws1.id);
    expect(ws1Docs).toHaveLength(2);

    const ws1Detail = await workspaceService.getById(ws1.id);
    expect(ws1Detail!.name).toBe('Active Workspace');

    // Verify ws2 state
    const ws2Docs = await documentService.listByWorkspace(ws2.id);
    expect(ws2Docs).toHaveLength(1);

    // Verify discussion thread integrity
    const messages = await discussionService.listByAnnotation(annotation.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].modelId).toBe('gpt-4o');

    // Delete ws2, verify ws1 unaffected
    db.db.prepare('DELETE FROM workspaces WHERE id = ?').run(ws2.id);
    const remainingWorkspaces = await workspaceService.list();
    expect(remainingWorkspaces).toHaveLength(1);
    expect(remainingWorkspaces[0].id).toBe(ws1.id);

    const ws1DocsAfter = await documentService.listByWorkspace(ws1.id);
    expect(ws1DocsAfter).toHaveLength(2);
  });

  it('should correctly handle annotation anchor prefix/suffix for long content', async () => {
    const workspace = await workspaceService.create('Long Content WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'long.md',
      '# Long\n\nContent.',
    );

    const now = new Date().toISOString();

    // Build a long section content (more than 50 chars before and after the target)
    const longPrefix = 'A'.repeat(100);
    const targetText = 'TARGET_MARKER';
    const longSuffix = 'B'.repeat(100);
    const sectionContent = longPrefix + targetText + longSuffix;

    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-long', importResult.document.id, 'Long Guide', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-long', 'art-long', 0, 'Section', '[]', sectionContent, 'completed', now, now);

    const annotation = await annotationService.create({
      articleId: 'art-long',
      sectionId: 'sec-long',
      selectedText: targetText,
      type: 'highlight',
    });

    // Prefix should be capped at 50 chars (the last 50 chars of the prefix portion)
    expect(annotation.anchorPrefix).toBe('A'.repeat(50));
    // Suffix should be capped at 50 chars (the first 50 chars of the suffix portion)
    expect(annotation.anchorSuffix).toBe('B'.repeat(50));
    expect(annotation.anchorStartOffset).toBe(100);
    expect(annotation.anchorEndOffset).toBe(100 + targetText.length);
  });

  it('should support delete-and-recreate annotation workflow', async () => {
    const workspace = await workspaceService.create('Recreate WS');
    const importResult = await documentService.importFromContent(
      workspace.id,
      'recreate.md',
      '# Recreate\n\nDynamic content here.',
    );

    const now = new Date().toISOString();
    db.db
      .prepare(
        `INSERT INTO generated_articles (id, source_document_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('art-recreate', importResult.document.id, 'Recreate Article', 'completed', now, now);
    db.db
      .prepare(
        `INSERT INTO generated_sections (id, article_id, "index", title, source_chapter_ids, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('sec-recreate', 'art-recreate', 0, 'Section', '[]', 'Dynamic content here.', 'completed', now, now);

    // Create annotation with discussion
    const ann1 = await annotationService.create({
      articleId: 'art-recreate',
      sectionId: 'sec-recreate',
      selectedText: 'Dynamic',
      type: 'note',
      content: 'First annotation',
    });

    await discussionService.addMessage({ annotationId: ann1.id, role: 'user', content: 'First question' });
    await discussionService.addMessage({ annotationId: ann1.id, role: 'assistant', content: 'First answer' });

    // Verify state
    let anns = await annotationService.listBySection('sec-recreate');
    expect(anns).toHaveLength(1);
    let msgs = await discussionService.listByAnnotation(ann1.id);
    expect(msgs).toHaveLength(2);

    // Delete annotation (discussions cascade)
    await annotationService.delete(ann1.id);
    anns = await annotationService.listBySection('sec-recreate');
    expect(anns).toHaveLength(0);
    msgs = await discussionService.listByAnnotation(ann1.id);
    expect(msgs).toHaveLength(0);

    // Recreate annotation at the same text position
    const ann2 = await annotationService.create({
      articleId: 'art-recreate',
      sectionId: 'sec-recreate',
      selectedText: 'Dynamic',
      type: 'question',
      content: 'Second annotation (recreated)',
    });

    expect(ann2.id).not.toBe(ann1.id);
    expect(ann2.type).toBe('question');
    expect(ann2.anchorExactText).toBe('Dynamic');

    // Add new discussion to recreated annotation
    await discussionService.addMessage({ annotationId: ann2.id, role: 'user', content: 'Second question' });

    anns = await annotationService.listBySection('sec-recreate');
    expect(anns).toHaveLength(1);
    msgs = await discussionService.listByAnnotation(ann2.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Second question');
  });
});
