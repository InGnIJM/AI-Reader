# Code Analysis Harness MVP Design

## 1. Goal

Build the first MVP of the code analysis board in AI-Reader.

The MVP lets a user select a code project directory, enter an analysis goal, and let the model autonomously call read-only project tools to produce a Markdown analysis document. The generated document supports Feishu-like comments: comments attach to selected text, do not modify the document body, automatically trigger a model reply, and can be exported with the document.

Document reading for PDF, DOCX, EPUB, and general learning material is out of scope for this MVP and remains a later board.

## 2. Product Scope

### In Scope

- Select a local code directory.
- Enter an arbitrary analysis goal in a bottom prompt box.
- Run a model-driven analysis harness with autonomous read-only tool calls.
- Generate a Markdown analysis document according to the user goal.
- Show tool call progress while analysis runs.
- Render the generated Markdown document in a reading pane.
- Drag-select text in the generated document and create a comment.
- Automatically call the model to answer the comment.
- Show comments and AI replies in a right-side comment panel.
- Export a human-readable Markdown file.
- Export a structured `.aireader.json` package that can restore the document, comments, replies, and tool trace.

### Out of Scope

- Modifying source files.
- Running shell commands.
- Installing dependencies.
- Long-term memory.
- Vector search.
- Multi-user collaboration.
- PDF, DOCX, EPUB, and general document reading.
- Full Codex-style coding agent behavior.

## 3. User Flow

1. User opens the code analysis board.
2. User selects a project directory.
3. User enters an analysis goal, such as "analyze the architecture and risks".
4. The harness starts a tool loop.
5. The model autonomously requests read-only tools.
6. The app executes approved read-only tools and records traces.
7. The model generates a Markdown analysis document.
8. The user reads the document.
9. The user selects text and adds a comment/question.
10. The app saves the comment and automatically asks the model for a reply.
11. The reply appears in the comment thread.
12. The user exports Markdown and `.aireader.json`.

## 4. Harness Architecture

The harness is the core of this MVP. It has three primary modules.

### 4.1 Context Builder

Responsibilities:

- Represent the selected project directory safely.
- Build a lightweight project index.
- Apply default ignore rules.
- Track context budget.
- Summarize or truncate large tool results.
- Maintain a compact trace summary for later model turns.

Default ignore rules:

- `.git`
- `node_modules`
- `dist`
- `build`
- `coverage`
- `.turbo`
- generated lock or cache output when not directly requested

The context builder must never include files outside the selected project root.

### 4.2 Prompt Builder

Responsibilities:

- Build stable prompts for the autonomous analysis loop.
- Keep system, developer/context, user goal, tool trace, and final output contract separate.
- Require Markdown final output.
- Require evidence-backed statements with file path references when possible.
- Require uncertainty labeling when evidence is missing.

Prompt sections:

- System: read-only code analysis assistant.
- Context: selected directory, project index, available tools, call budget.
- User: the user's current analysis goal.
- Tool trace: summarized prior tool calls and observations.
- Output contract: generate a Markdown document shaped by the user goal.

The generated document is not a fixed report template. The user goal controls what the document should contain.

### 4.3 Tool Loop

The model can autonomously call tools. The MVP supports only read-only tools:

- `listFiles(path?, depth?)`
- `readFile(path, startLine?, endLine?)`
- `searchText(query, path?, maxResults?)`

Default limits:

- Maximum tool calls per analysis: 15.
- Tool paths must resolve inside the selected project root.
- `readFile` must enforce line and character limits.
- `searchText` must enforce max result count and per-result snippet length.
- Overlong tool results are summarized before being returned to the model.
- When budget is exhausted, the model must produce the best possible Markdown document and state remaining uncertainty.

Tool traces are persisted as part of the analysis document.

## 5. Analysis Document

The harness output is stored as an `AnalysisDocument`.

Required fields:

- `id`
- `projectId`
- `goal`
- `contentMarkdown`
- `status`: `pending | running | completed | failed`
- `modelId`
- `toolCallCount`
- `createdAt`
- `updatedAt`

The document body is Markdown. It is independent from comments. Comments do not mutate the body.

## 6. Comments And AI Replies

Comments are attached to generated analysis documents, not to source files.

### 6.1 Comment Creation

When the user selects text in the generated document:

1. The app records the selection.
2. A floating "add comment" affordance appears.
3. The user enters a comment/question.
4. The app saves the comment immediately.
5. The app automatically starts AI reply generation.

### 6.2 Anchoring

Use a three-layer text anchor:

- `anchorStartOffset` and `anchorEndOffset`
- `anchorExactText`
- `anchorPrefix` and `anchorSuffix`

The first implementation may locate highlights by exact text and offset. Prefix/suffix are stored to support later relocation when the document changes.

### 6.3 Reply Context

Comment replies reuse the harness model layer but do not rerun the full analysis. The reply context includes:

- Selected text.
- Surrounding paragraph or heading context.
- Original analysis goal.
- Analysis document content, capped by budget.
- Tool trace summary and referenced files.
- User comment/question.
- Existing comment thread messages.

For MVP, comment replies may use at most 3 additional read-only tool calls if the model needs project evidence.

### 6.4 Failure Handling

- The comment is saved before calling the model.
- If AI reply fails, the comment status becomes `failed`.
- The user can retry.
- Retry appends a new attempt or updates failed state without deleting prior successful replies.

## 7. Export And Reimport

### 7.1 Markdown Export

Markdown export is for humans.

It includes:

- Title.
- Original analysis goal.
- Generated analysis document.
- Comment index.
- Each comment's selected quote, user question, AI replies, and timestamps.

The export may add lightweight footnote-style markers such as `[Comment 1]`, but must not disrupt the original reading flow.

### 7.2 `.aireader.json` Export

`.aireader.json` is for app reimport.

Required structure:

- `schemaVersion`
- `type: "code-analysis-document"`
- `sourceDirectoryName`
- `sourceDirectoryPathHash`
- `analysisGoal`
- `analysisMarkdown`
- `toolTrace`
- `referencedFiles`
- `annotations`
- `discussionMessages`
- `modelInfo`
- `createdAt`
- `exportedAt`

Security rules:

- Do not export API keys.
- Do not export absolute source directory paths by default.
- Do not export full source file contents by default.
- Source snippets require a future explicit user setting.

Reimport from `.aireader.json` restores the generated document, comments, replies, and tool trace. It does not require the original source directory to exist. A future version may let the user relink a source directory.

## 8. UI Design

Use a dark developer workbench style similar to Codex or Claude Desktop.

### 8.1 Layout

Desktop-first layout:

- Left sidebar: project directory, analysis history, import/export actions.
- Center pane: generated Markdown analysis document.
- Right sidebar: comments and AI reply threads.
- Bottom prompt box: main command input for analysis goals.

Target minimum window size: `1024 x 768`.

Recommended panel widths:

- Left: `260px`
- Right: `360px`
- Center: flexible with Markdown content max width around `820px`

### 8.2 Visual System

Use a dark-only MVP theme.

Colors:

- App background: `#0F172A`
- Main surface: `#111827` or `#0B1120`
- Sidebar surface: `#0B1220`
- Hover/selected surface: `#1E293B`
- Divider: `#334155`
- Primary text: `#F8FAFC`
- Secondary text: `#94A3B8`
- Muted text: `#64748B`
- Analysis/run accent: `#22C55E`
- Comment accent: `#F59E0B` or `#FACC15`
- Error: `#EF4444`

Rules:

- Do not use emojis as icons.
- Use one icon family. The existing project uses Material Symbols, so MVP can continue using it.
- Icon-only controls need `aria-label` and `title`.
- Preserve visible focus rings.
- Avoid large rounded cards. Use 8px radius for panels and repeated items.

### 8.3 Key Components

- `CodeAnalysisWorkbench`
- `ProjectSidebar`
- `AnalysisPromptBox`
- `ToolTraceTimeline`
- `AnalysisMarkdownViewer`
- `TextSelectionPopover`
- `AnnotationHighlightLayer`
- `AnnotationSidebar`
- `AnnotationThread`
- `ExportMenu`
- `ImportAnalysisDialog`

### 8.4 Interaction States

Required states:

- No project selected.
- Project selected, no analysis document.
- Analysis running.
- Tool call in progress.
- Analysis failed.
- Analysis completed.
- No comments.
- Comment reply pending.
- Comment reply failed with retry.
- Export success/failure.
- Reimport success/failure.

## 9. Data Model

Add code-analysis-specific tables instead of reusing document-reading tables.

### `code_projects`

- `id`
- `name`
- `root_path`
- `root_path_hash`
- `created_at`
- `updated_at`

### `analysis_documents`

- `id`
- `project_id`
- `goal`
- `content_markdown`
- `status`
- `model_id`
- `tool_call_count`
- `created_at`
- `updated_at`

### `analysis_tool_traces`

- `id`
- `analysis_document_id`
- `step_index`
- `tool_name`
- `tool_args_json`
- `result_summary`
- `created_at`

### `analysis_annotations`

- `id`
- `analysis_document_id`
- `anchor_start_offset`
- `anchor_end_offset`
- `anchor_exact_text`
- `anchor_prefix`
- `anchor_suffix`
- `question`
- `status`
- `created_at`
- `updated_at`

### `analysis_discussion_messages`

- `id`
- `annotation_id`
- `role`
- `content`
- `model_id`
- `created_at`

## 10. Reuse From Current Project

Reusable as-is or with small changes:

- `LLMProvider` interface in `packages/core`.
- `OpenAICompatibleProvider`.
- SQLite database initialization pattern.
- IPC result wrapper and shared IPC channel pattern.
- `MarkdownRenderer` and its text selection callback.
- `TextSelectionToolbar`, adapted into a comment composer affordance.
- `AnnotationPanel`, adapted to analysis comments.
- `AiReplyStream` and `DiscussionThread`.
- Three-column layout structure from `ReaderLayout`.
- Existing service E2E testing style.

Partially reusable:

- `AnnotationService` and `DiscussionService` logic, but not their current table bindings.
- `AIReplyEngine` flow, but with analysis-document context instead of article/section context.
- `GenerationJobService` state-machine ideas.

Not recommended for this MVP:

- `DocumentImportService`
- `DocumentParser`
- `ArticleGenerator`
- `generated_articles` and `generated_sections` tables
- Current `App.tsx` flow, which is tied to document import and chapter reading.

Known project risks:

- Current tests fail in `@ai-reader/desktop`, mostly around database setup. This should be fixed or isolated before relying on new test results.
- Chinese text appears garbled in some terminal output. Encoding should be verified before broad UI copy changes.

## 11. Testing Strategy

The MVP requires a strong test harness because model analysis harness behavior is central.

### Unit Tests

- Context builder ignores excluded folders.
- Context builder prevents paths escaping the selected root.
- Prompt builder includes goal, tool descriptions, budget, and output contract.
- Tool registry validates tool args.
- `listFiles` respects depth and ignore rules.
- `readFile` respects line and character limits.
- `searchText` respects max results and path scope.
- Tool loop stops after 15 calls.
- Tool loop returns final Markdown when budget is exhausted.
- Analysis comment anchoring stores offset, exact text, prefix, and suffix.
- Export service produces valid Markdown and valid `.aireader.json`.
- Reimport validates schema version and restores state.

### Integration Tests

Use a mock LLM that requests deterministic tool calls.

Required full-chain test:

1. Create code project with fixture files.
2. Run analysis goal.
3. Mock LLM calls `listFiles`, `readFile`, and `searchText`.
4. Mock LLM returns Markdown.
5. Persist analysis document and tool traces.
6. Create a comment on selected document text.
7. Mock LLM returns comment reply.
8. Export Markdown and `.aireader.json`.
9. Reimport `.aireader.json`.
10. Verify document, comments, replies, and traces are restored.

### UI Tests

- Prompt box starts analysis.
- Tool timeline updates while analysis runs.
- Markdown renders generated content.
- Text selection opens comment affordance.
- Comment submit creates pending comment.
- Streaming reply displays in right sidebar.
- Clicking a comment locates the highlighted text.
- Export menu triggers both export types.

## 12. Acceptance Criteria

- User can select a code directory.
- User can enter an arbitrary analysis goal.
- Model can autonomously call read-only tools.
- Default tool call limit is 15.
- Analysis result is generated as Markdown.
- Tool trace is visible and persisted.
- User can select generated Markdown text and create a comment.
- Comment automatically triggers an AI reply.
- Comments do not modify the document body.
- Comments and replies persist after app restart.
- Exported Markdown includes the document and comments.
- Exported `.aireader.json` can be reimported to restore the state.
- No source files are modified by the MVP.
- No shell commands are executed by the MVP.
