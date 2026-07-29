import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * 工作区
 */
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 文档
 */
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(),
  fileHash: text('file_hash').notNull(),
  title: text('title'),
  rawText: text('raw_text').notNull(),
  status: text('status').notNull().default('importing'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 章节
 */
export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  title: text('title').notNull(),
  level: integer('level').notNull().default(1),
  content: text('content').notNull(),
});

/**
 * AI 生成的文章
 */
export const generatedArticles = sqliteTable('generated_articles', {
  id: text('id').primaryKey(),
  sourceDocumentId: text('source_document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  outlineJson: text('outline_json'),
  status: text('status').notNull().default('generating'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * AI 生成的章节
 */
export const generatedSections = sqliteTable('generated_sections', {
  id: text('id').primaryKey(),
  articleId: text('article_id')
    .notNull()
    .references(() => generatedArticles.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  title: text('title').notNull(),
  sourceChapterIds: text('source_chapter_ids').notNull(),
  content: text('content'),
  status: text('status').notNull().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 生成任务
 */
export const generationJobs = sqliteTable('generation_jobs', {
  id: text('id').primaryKey(),
  documentId: text('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  totalSections: integer('total_sections').notNull().default(0),
  completedSections: integer('completed_sections').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 批注
 */
export const annotations = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  articleId: text('article_id')
    .notNull()
    .references(() => generatedArticles.id, { onDelete: 'cascade' }),
  sectionId: text('section_id')
    .notNull()
    .references(() => generatedSections.id, { onDelete: 'cascade' }),
  anchorStartOffset: integer('anchor_start_offset').notNull(),
  anchorEndOffset: integer('anchor_end_offset').notNull(),
  anchorExactText: text('anchor_exact_text').notNull(),
  anchorPrefix: text('anchor_prefix').notNull(),
  anchorSuffix: text('anchor_suffix').notNull(),
  type: text('type').notNull().default('note'),
  content: text('content'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * 讨论消息
 */
export const discussionMessages = sqliteTable('discussion_messages', {
  id: text('id').primaryKey(),
  annotationId: text('annotation_id')
    .notNull()
    .references(() => annotations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  modelId: text('model_id'),
  tokenUsage: text('token_usage'),
  createdAt: text('created_at').notNull(),
});

/**
 * LLM 使用记录
 */
export const llmUsageRecords = sqliteTable('llm_usage_records', {
  id: text('id').primaryKey(),
  requestType: text('request_type').notNull(),
  modelId: text('model_id').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  cost: real('cost'),
  createdAt: text('created_at').notNull(),
});

/**
 * 应用设置
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const codeProjects = sqliteTable(
  'code_projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    rootPathHash: text('root_path_hash').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    rootPathHashIndex: uniqueIndex('ux_code_projects_root_path_hash').on(
      table.rootPathHash,
    ),
  }),
);

export const analysisSessions = sqliteTable(
  'analysis_sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => codeProjects.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    activeBranchId: text('active_branch_id').references(
      (): AnySQLiteColumn => analysisBranches.id,
      { onDelete: 'set null' },
    ),
    activeDocumentId: text('active_document_id').references(
      (): AnySQLiteColumn => analysisDocuments.id,
      { onDelete: 'set null' },
    ),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    statusCheck: check(
      'analysis_sessions_status_check',
      sql`${table.status} IN ('active', 'archived')`,
    ),
    projectStatusUpdatedIndex: index(
      'idx_analysis_sessions_project_status_updated',
    ).on(table.projectId, table.status, sql`${table.updatedAt} DESC`),
  }),
);

export const analysisBranches = sqliteTable(
  'analysis_branches',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references((): AnySQLiteColumn => analysisSessions.id, {
        onDelete: 'cascade',
      }),
    name: text('name').notNull(),
    parentBranchId: text('parent_branch_id').references(
      (): AnySQLiteColumn => analysisBranches.id,
      { onDelete: 'set null' },
    ),
    forkedFromDocumentId: text('forked_from_document_id').references(
      (): AnySQLiteColumn => analysisDocuments.id,
      { onDelete: 'set null' },
    ),
    headDocumentId: text('head_document_id').references(
      (): AnySQLiteColumn => analysisDocuments.id,
      { onDelete: 'set null' },
    ),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    sessionIndex: index('idx_analysis_branches_session').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const analysisDocuments = sqliteTable(
  'analysis_documents',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => codeProjects.id, {
      onDelete: 'cascade',
    }),
    sessionId: text('session_id').references(
      (): AnySQLiteColumn => analysisSessions.id,
      { onDelete: 'cascade' },
    ),
    branchId: text('branch_id').references(
      (): AnySQLiteColumn => analysisBranches.id,
      { onDelete: 'cascade' },
    ),
    parentDocumentId: text('parent_document_id').references(
      (): AnySQLiteColumn => analysisDocuments.id,
      { onDelete: 'cascade' },
    ),
    goal: text('goal').notNull(),
    contentMarkdown: text('content_markdown').notNull().default(''),
    status: text('status').notNull().default('pending'),
    modelId: text('model_id'),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    projectIndex: index('idx_analysis_documents_project').on(table.projectId),
    sessionIndex: index('idx_analysis_documents_session').on(
      table.sessionId,
      table.createdAt,
    ),
    branchIndex: index('idx_analysis_documents_branch').on(
      table.branchId,
      table.createdAt,
    ),
    parentIndex: index('idx_analysis_documents_parent').on(
      table.parentDocumentId,
    ),
  }),
);

export const analysisToolTraces = sqliteTable(
  'analysis_tool_traces',
  {
    id: text('id').primaryKey(),
    analysisDocumentId: text('analysis_document_id')
      .notNull()
      .references(() => analysisDocuments.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    toolName: text('tool_name').notNull(),
    toolArgsJson: text('tool_args_json').notNull(),
    resultSummary: text('result_summary').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    documentIndex: index('idx_analysis_tool_traces_document').on(
      table.analysisDocumentId,
    ),
  }),
);

export const analysisAnnotations = sqliteTable(
  'analysis_annotations',
  {
    id: text('id').primaryKey(),
    analysisDocumentId: text('analysis_document_id')
      .notNull()
      .references(() => analysisDocuments.id, { onDelete: 'cascade' }),
    anchorStartOffset: integer('anchor_start_offset').notNull(),
    anchorEndOffset: integer('anchor_end_offset').notNull(),
    anchorExactText: text('anchor_exact_text').notNull(),
    selectedText: text('selected_text').notNull().default(''),
    anchorPrefix: text('anchor_prefix').notNull(),
    anchorSuffix: text('anchor_suffix').notNull(),
    question: text('question').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    documentIndex: index('idx_analysis_annotations_document').on(
      table.analysisDocumentId,
    ),
  }),
);

export const analysisDiscussionMessages = sqliteTable(
  'analysis_discussion_messages',
  {
    id: text('id').primaryKey(),
    annotationId: text('annotation_id')
      .notNull()
      .references(() => analysisAnnotations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    modelId: text('model_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    annotationIndex: index('idx_analysis_discussion_messages_annotation').on(
      table.annotationId,
    ),
  }),
);

export const analysisFileCleanupQueue = sqliteTable(
  'analysis_file_cleanup_queue',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    relativePath: text('relative_path').notNull().unique(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    createdIndex: index('idx_analysis_file_cleanup_queue_created').on(
      table.createdAt,
    ),
  }),
);
