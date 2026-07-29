# Conversation Branching And Annotation Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-input-per-conversation code analysis with persistent multi-turn sessions, project/no-project drafts, session management, non-destructive rollback and branching, and bidirectional collapsible annotations.

**Architecture:** Keep `analysis_documents` as immutable user/assistant turns and add session/branch records above them. Main-process services own migration, ownership, context, cleanup, and state transitions; typed IPC exposes commands; React owns only draft, selection, and focus state.

**Tech Stack:** Electron 33, React 19, TypeScript, SQLite, better-sqlite3, Drizzle ORM, Vitest, Testing Library, Playwright, Material Design 3.

---

## Preconditions

Approved spec:

- `docs/superpowers/specs/2026-07-29-conversation-branching-and-annotation-navigation-design.md`

Current tests are blocked by a native ABI mismatch: `better_sqlite3.node` uses ABI 130 while Node tests require ABI 127. Before database tests:

```bash
pnpm rebuild better-sqlite3
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_vitest-discovery.ts
```

Expected: rebuild exits `0`; the smoke test passes. Before Electron E2E:

```bash
pnpm exec electron-builder install-app-deps
```

Expected: the native module is rebuilt for Electron. Never report database tests as passing while the ABI mismatch remains.

Every task uses Red -> Green -> Refactor and a commit of at most three files. Do not combine commits.

## File Map

**Database**

- `apps/desktop/src/main/db/{client.ts,schema.ts,code-analysis-migration.ts}`
- `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`
- `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`

**Services**

- Create `session-service.ts`, `branch-service.ts`, `cleanup-service.ts`, `anchor-resolver.ts`.
- Modify `service.ts`, `types.ts`, `context-builder.ts`, `prompt-builder.ts`, `export-service.ts`, `reply-engine.ts`, `annotation-service.ts`, `index.ts`.
- Tests remain under `apps/desktop/src/main/services/code-analysis/test/`.

**Contracts**

- `packages/shared/src/ipc/{types.ts,channels.ts}`
- `apps/desktop/src/main/ipc/{code-analysis.ts,index.ts}`
- `apps/desktop/src/preload/index.ts`

**Renderer**

- Modify `ProjectSidebar.tsx`, `AnalysisMarkdownViewer.tsx`, `AnnotationSidebar.tsx`, `MarkdownRenderer.tsx`, `CodeAnalysisWorkbench.tsx`, i18n, CSS, and matching tests.
- Create `ConversationTimeline.tsx` and focused component tests.

**E2E**

- `apps/desktop/playwright.config.ts`
- `apps/desktop/e2e/conversation-branching.spec.ts`
- `apps/desktop/e2e/support/mock-llm-server.ts`

## Task 1: Transitional Database Migration

**Files:** `apps/desktop/src/main/db/code-analysis-migration.ts`, `apps/desktop/src/main/db/client.ts`, `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`

- [ ] Write failing tests that migrate two legacy documents and preserve document, annotation, reply, and trace IDs.

```ts
expect(rows('analysis_sessions')).toHaveLength(2);
expect(rows('analysis_branches')).toHaveLength(2);
expect(db.pragma('foreign_key_check')).toEqual([]);
expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
```

- [ ] Add failing migration-level trigger tests for cross-session active pointers, turn/branch mismatch, cross-session parents, self/indirect parent cycles, and wrong branch heads.
- [ ] Add idempotency and rollback tests. Inject failure with `beforeCommit: () => { throw new Error('forced failure'); }`; assert legacy rows remain.
- [ ] Run `pnpm --filter @ai-reader/desktop test -- src/main/db/test/test_code-analysis-migration.ts`; expect missing-table failures.
- [ ] Implement transaction order: idle connection -> `foreign_keys=OFF` -> `BEGIN IMMEDIATE` -> create/rebuild/backfill -> create ownership/cycle triggers -> pre-commit `foreign_key_check` -> commit/rollback -> `foreign_keys=ON` in `finally`.
- [ ] Store version markers in `app_settings`: key `code_analysis_session_schema`, value `1`. Read it before migration, write it inside the same transaction after tables/triggers/checks succeed, and leave the previous value unchanged on rollback. Structure detection routes legacy -> v1 and skips v1 on repeat startup.
- [ ] Keep nullable `analysis_documents.project_id`, `session_id`, and `branch_id` temporarily so intermediate commits remain runnable. Fresh databases use the same transitional shape.
- [ ] Re-run the focused test; expect all cases PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/db/code-analysis-migration.ts apps/desktop/src/main/db/client.ts apps/desktop/src/main/db/test/test_code-analysis-migration.ts
git commit -m "feat(db): migrate analysis documents into sessions"
```

## Task 2: Transitional Drizzle Schema And Triggers

**Files:** `apps/desktop/src/main/db/schema.ts`, `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`, `apps/desktop/src/main/db/client.test.ts`

- [ ] Write failing tests that Drizzle declarations match the migrated table/column names, relations, nullability, cascade deletion, and cleanup-row survival.
- [ ] Run `pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_schema.ts src/main/db/client.test.ts`; expect schema failures.
- [ ] Add `analysisSessions`, `analysisBranches`, and `analysisFileCleanupQueue` (`analysis_file_cleanup_queue`); add nullable session/branch/parent fields to documents and `selectedText` to annotations.

```ts
export const analysisSessions = sqliteTable('analysis_sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => codeProjects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  activeBranchId: text('active_branch_id'),
  activeDocumentId: text('active_document_id'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

- [ ] Keep trigger behavior tests in Task 1. Task 2 verifies Drizzle declarations against the already-created SQL schema; during transition, document ownership fields remain nullable.
- [ ] Re-run focused tests; expect PASS and empty `foreign_key_check`.
- [ ] Commit:

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/services/code-analysis/test/test_schema.ts apps/desktop/src/main/db/client.test.ts
git commit -m "feat(db): enforce analysis session ownership"
```

## Task 3: Shared Session Contracts

**Files:** `packages/shared/src/ipc/types.ts`, `packages/shared/src/ipc/channels.ts`, new `packages/shared/src/ipc/test/test_code-analysis-session-types.ts`

- [ ] Write a failing contract fixture using session, branch, turn, detail, `runTurn`, checkout, management, and source-offset annotation payloads.
- [ ] Run `pnpm --filter @ai-reader/shared test -- src/ipc/test/test_code-analysis-session-types.ts`; expect missing exports.
- [ ] Add these core contracts and all specified IPC constants:

```ts
type AnalysisSessionStatus = 'active' | 'archived';
interface CodeAnalysisRunTurnPayload {
  sessionId?: string;
  projectId?: string | null;
  parentDocumentId?: string;
  goal: string;
  forceFork?: boolean;
}
interface CodeAnalysisCheckoutTurnPayload {
  sessionId: string;
  branchId: string;
  documentId: string;
}
```

- [ ] Keep legacy contracts additive until renderer migration is complete.
- [ ] Run `pnpm --filter @ai-reader/shared test` and `pnpm --filter @ai-reader/shared build`; expect both PASS.
- [ ] Commit:

```bash
git add packages/shared/src/ipc/types.ts packages/shared/src/ipc/channels.ts packages/shared/src/ipc/test/test_code-analysis-session-types.ts
git commit -m "feat(shared): define analysis session contracts"
```

## Task 4: Session Lifecycle Service

**Files:** new `apps/desktop/src/main/services/code-analysis/session-service.ts`, new `apps/desktop/src/main/services/code-analysis/test/test_session-service.ts`, `apps/desktop/src/main/services/code-analysis/index.ts`

- [ ] Write failing tests for project/no-project listing, global recents, active/archive filtering, trimmed 1–80 character titles, archive, restore, running-session archive/delete rejection, confirmation, and deletion queue insertion.
- [ ] Run the focused test; expect missing service:

```bash
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_session-service.ts
```

- [ ] Implement:

```ts
class AnalysisSessionService {
  constructor(
    db: DatabaseClient,
    cleanup?: { processPending(): Promise<{ processed: number; pending: number }> },
  );
  listByProject(projectId: string | null, status: AnalysisSessionStatus): Promise<AnalysisSession[]>;
  listRecent(input: { status: AnalysisSessionStatus; limit?: number }): Promise<AnalysisSession[]>;
  getDetail(sessionId: string): Promise<AnalysisSessionDetail | null>;
  rename(sessionId: string, title: string): Promise<AnalysisSession>;
  archive(sessionId: string): Promise<AnalysisSession>;
  restore(sessionId: string): Promise<AnalysisSession>;
  deletePermanently(sessionId: string, confirmed: boolean): Promise<{ cleanupPending: boolean }>;
}
```

- [ ] Permanent delete must enqueue `generated-documents/<turnId>` and delete the session in one transaction; process cleanup only after commit.
- [ ] Re-run; expect lifecycle, validation, and queue tests PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/session-service.ts apps/desktop/src/main/services/code-analysis/test/test_session-service.ts apps/desktop/src/main/services/code-analysis/index.ts
git commit -m "feat(desktop): add analysis session management"
```

## Task 5: Branch Paths And Non-Destructive Checkout

**Files:** new `apps/desktop/src/main/services/code-analysis/branch-service.ts`, new `apps/desktop/src/main/services/code-analysis/test/test_branch-service.ts`, `apps/desktop/src/main/services/code-analysis/types.ts`

- [ ] Write failing tests for root-to-head path resolution, shared ancestors, checkout with explicit branch context, switch-to-head, rename, cross-session rejection, cycle defense, and running-session checkout/switch rejection.

```ts
expect((await service.resolvePath('session-1', 'branch-child')).map((turn) => turn.id))
  .toEqual(['turn-1', 'turn-child']);
```

- [ ] Run the focused test; expect missing service.
- [ ] Implement `list`, `resolvePath`, `checkout`, `switchBranch`, `rename`, and `decideWrite`.
- [ ] `checkout` accepts only documents in the requested branch path and changes session pointers only. `decideWrite` forks when parent is not branch head or `forceFork=true`.
- [ ] Re-run; expect PASS with no deleted or rewritten turns.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/branch-service.ts apps/desktop/src/main/services/code-analysis/test/test_branch-service.ts apps/desktop/src/main/services/code-analysis/types.ts
git commit -m "feat(desktop): add non-destructive analysis branches"
```

## Task 6: Bounded Multi-Turn Context

**Files:** `apps/desktop/src/main/services/code-analysis/context-builder.ts`, `apps/desktop/src/main/services/code-analysis/prompt-builder.ts`, `apps/desktop/src/main/services/code-analysis/test/test_context-prompt.ts`

- [ ] Write failing tests for exact system/user/assistant order, one project-context block, no directory tools for no-project sessions, sibling isolation, and whole-pair pruning.

```ts
expect(messages.map(({ role, content }) => [role, content])).toEqual([
  ['system', expect.stringContaining('read-only')],
  ['user', 'Question one'],
  ['assistant', 'Answer one'],
  ['user', 'Question two'],
]);
```

- [ ] Run the focused test; expect failure because only one goal is supported.
- [ ] Implement root-to-parent history, a 60,000-character history budget, newest complete-pair retention, and an explicit omission marker. Never truncate system constraints/current input or include sibling/failed-empty turns.
- [ ] Re-run; expect all ordering and budget cases PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/context-builder.ts apps/desktop/src/main/services/code-analysis/prompt-builder.ts apps/desktop/src/main/services/code-analysis/test/test_context-prompt.ts
git commit -m "feat(desktop): build multi-turn analysis context"
```

## Task 7: Transactional Turn Execution

**Files:** `apps/desktop/src/main/services/code-analysis/service.ts`, `apps/desktop/src/main/services/code-analysis/test/test_service.ts`, `apps/desktop/src/main/services/code-analysis/test/test_service-lists.ts`

- [ ] Replace separate-document expectations with failing tests for first turn, same-session second turn, automatic/history fork, forced head fork, one running turn per session, failure retention, and local file output.

```ts
const first = await service.runTurn({ projectId: project.id, goal: 'First' });
const second = await service.runTurn({ sessionId: first.session.id, goal: 'Second' });
expect(second.session.id).toBe(first.session.id);
expect(second.turn.parentDocumentId).toBe(first.turn.id);
```

- [ ] Run both focused test files; expect missing `runTurn`.
- [ ] First send atomically creates session -> main branch -> running turn -> active pointers. Continuation uses `decideWrite`, resolved history, and one transaction for ownership updates.
- [ ] On success persist Markdown/traces/head/pointers; on failure retain a failed turn. During transition mirror session project ID into document `project_id`.
- [ ] Replace project counts/document lists with session queries while keeping turn-level get/trace helpers.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/service.ts apps/desktop/src/main/services/code-analysis/test/test_service.ts apps/desktop/src/main/services/code-analysis/test/test_service-lists.ts
git commit -m "feat(desktop): execute analysis turns in sessions"
```

## Task 8: Export And Import Compatibility

**Files:** `apps/desktop/src/main/services/code-analysis/export-service.ts`, `apps/desktop/src/main/services/code-analysis/test/test_export-service.ts`

- [ ] Write failing tests that derive project metadata through the session, export only the requested turn/annotations, and import one session/main branch/turn with active pointers.
- [ ] Run the focused test; expect failures from direct document `project_id` queries.
- [ ] Join document -> session -> project. Import all current-turn data in one transaction. Do not export the entire branch tree.
- [ ] Re-run; expect PASS and no absolute source path in JSON.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/export-service.ts apps/desktop/src/main/services/code-analysis/test/test_export-service.ts
git commit -m "fix(desktop): preserve exports with session turns"
```

## Task 9: Annotation Reply Context

**Files:** `apps/desktop/src/main/services/code-analysis/reply-engine.ts`, `apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts`

- [ ] Write a failing test: an annotation on turn two includes turn-two content and ordered discussion, but excludes sibling content.
- [ ] Run the focused test; expect old ownership-query failure.
- [ ] Select the annotated turn by `analysis_document_id`; join its session only for project metadata; build reply context from that turn plus discussion messages.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/reply-engine.ts apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts
git commit -m "fix(desktop): preserve annotation reply context"
```

## Task 10: Durable Cleanup Queue

**Files:** new `apps/desktop/src/main/services/code-analysis/cleanup-service.ts`, new `apps/desktop/src/main/services/code-analysis/test/test_cleanup-service.ts`, `apps/desktop/src/main/ipc/index.ts`

- [ ] Write failing tests for valid `generated-documents/<id>`, absolute/traversal rejection, success, `ENOENT`, failure retry counters, and queue-only processing.
- [ ] Run the focused test; expect missing service.
- [ ] Implement:

```ts
class AnalysisCleanupService {
  constructor(db: DatabaseClient, userDataRoot: string);
  resolveManagedPath(relativePath: string): string;
  processPending(): Promise<{ processed: number; pending: number }>;
}
```

- [ ] Instantiate with `dirname(localDocumentsPath)`, inject into session service, and retry once at startup. Never scan unregistered directories.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/cleanup-service.ts apps/desktop/src/main/services/code-analysis/test/test_cleanup-service.ts apps/desktop/src/main/ipc/index.ts
git commit -m "feat(desktop): retry analysis file cleanup"
```

## Task 11: Main IPC Handlers

**Files:** `apps/desktop/src/main/ipc/code-analysis.ts`, `apps/desktop/src/main/ipc/test_code-analysis.test.ts`, `apps/desktop/src/main/ipc/index.ts`

- [ ] Write failing handler tests for list/get/rename/archive/restore/delete, `runTurn`, checkout, list/switch/rename branch, ownership errors, and path non-disclosure.
- [ ] Run the focused IPC test; expect missing handlers.
- [ ] Register object-payload handlers through the existing `handle` wrapper:

```ts
ipcMain.handle(IPC_CHANNELS.CODE_ANALYSIS_CHECKOUT_TURN, (_event, payload) =>
  handle('codeAnalysis:checkoutTurn', () => deps.branchService.checkout(payload)),
);
```

- [ ] Instantiate/inject branch service in `ipc/index.ts`; all write ownership checks stay in main-process services.
- [ ] Re-run IPC tests and `pnpm --filter @ai-reader/desktop type-check`; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/ipc/code-analysis.ts apps/desktop/src/main/ipc/test_code-analysis.test.ts apps/desktop/src/main/ipc/index.ts
git commit -m "feat(desktop): expose analysis session IPC"
```

## Task 12: Typed Preload API

**Files:** `apps/desktop/src/preload/index.ts`, new `apps/desktop/src/preload/test/test_code-analysis-api.ts`

- [ ] Mock `contextBridge.exposeInMainWorld` and `ipcRenderer.invoke`; write failing forwarding tests for every new channel/payload.

```ts
await exposedApi.codeAnalysis.runTurn({ sessionId: 'session-1', goal: 'Continue' });
expect(invoke).toHaveBeenCalledWith(
  IPC_CHANNELS.CODE_ANALYSIS_RUN_TURN,
  { sessionId: 'session-1', goal: 'Continue' },
);
```

- [ ] Run the focused test; expect missing preload methods.
- [ ] Expose all session/branch/turn/annotation methods using shared payload/result types. Keep `ElectronAPI = typeof api`.
- [ ] Re-run test and desktop type-check; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/preload/test/test_code-analysis-api.ts
git commit -m "feat(preload): expose analysis session API"
```

## Task 13: Deterministic Annotation Anchors

**Files:** new `apps/desktop/src/main/services/code-analysis/anchor-resolver.ts`, `apps/desktop/src/main/services/code-analysis/annotation-service.ts`, `apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts`

- [ ] Write failing tests for offset validation, unique exact match, prefix/suffix duplicate disambiguation, invalid anchors, and persisted `selected_text`.
- [ ] Run the focused annotation test; expect failure because `indexOf` chooses the first duplicate.
- [ ] Implement resolution order: valid offset -> unique exact -> prefix/exact/suffix -> invalid. Creation accepts source offsets, rereads persisted Markdown, derives exact/prefix/suffix in main, and rejects mismatches.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/services/code-analysis/anchor-resolver.ts apps/desktop/src/main/services/code-analysis/annotation-service.ts apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts
git commit -m "fix(desktop): resolve annotation source anchors"
```

## Task 14: Markdown Source Mapping And Marks

**Files:** `apps/desktop/src/renderer/components/common/MarkdownRenderer.tsx`, `apps/desktop/src/renderer/components/common/MarkdownRenderer.test.tsx`, `apps/desktop/src/renderer/components/code-analysis/AnalysisMarkdownViewer.tsx`

- [ ] Write failing tests for selection across bold/link/code text nodes, duplicate text, merged marks, and click/Enter/Space activation.

```ts
expect(onTextSelect).toHaveBeenCalledWith({
  selectedText: 'bold and link',
  sourceStartOffset: expect.any(Number),
  sourceEndOffset: expect.any(Number),
});
```

- [ ] Run the renderer test; expect old Range-only callback failure.
- [ ] Attach AST/HAST source positions to rendered text-bearing nodes, map DOM selection to one continuous source range, and render focusable `<mark data-annotation-ids>`.
- [ ] Update viewer props for annotations, active ID, selection, and activation.
- [ ] Re-run; expect formatting, duplicate, mark, and keyboard tests PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/renderer/components/common/MarkdownRenderer.tsx apps/desktop/src/renderer/components/common/MarkdownRenderer.test.tsx apps/desktop/src/renderer/components/code-analysis/AnalysisMarkdownViewer.tsx
git commit -m "feat(renderer): map annotations to markdown source"
```

## Task 15: Collapsible Annotation Sidebar

**Files:** `apps/desktop/src/renderer/components/code-analysis/AnnotationSidebar.tsx`, new `apps/desktop/src/renderer/components/code-analysis/test/test_AnnotationSidebar.tsx`, `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`

- [ ] Write failing tests: active item expanded, others collapsed, manual expansion, grouped-by-turn display, source link, focus scroll, invalid-anchor state, and `aria-expanded`.
- [ ] Run the focused component test; expect missing disclosure behavior.
- [ ] Add `activeAnnotationId`, `onActivate`, and `onViewSource`; use accessible disclosure rows and ref-based focus. Use 150–200 ms motion disabled by `prefers-reduced-motion`.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/renderer/components/code-analysis/AnnotationSidebar.tsx apps/desktop/src/renderer/components/code-analysis/test/test_AnnotationSidebar.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
git commit -m "feat(renderer): add collapsible analysis annotations"
```

## Task 16: Project Session Tree

**Files:** `apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx`, new `apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx`, `apps/desktop/src/renderer/pages/code-analysis-i18n.ts`

- [ ] Write failing tests for global recents, collapsible project/no-project folders, per-folder new-session icons, active counts, active/archive control, rename validation/save/cancel, archive/restore, and delete-confirmation request.
- [ ] Run focused test; expect document-oriented prop failures.
- [ ] Replace document props with sessions. Use Material Symbols, tooltips, icon buttons, a segmented status control, and inline title editor (`Enter`, `Esc`, blur).
- [ ] Add complete Chinese/English labels.
- [ ] Re-run in both languages; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx apps/desktop/src/renderer/pages/code-analysis-i18n.ts
git commit -m "feat(renderer): render project session folders"
```

## Task 17: Conversation Timeline And Branch Controls

**Files:** new `apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx`, new `apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx`, `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`

- [ ] Write failing tests for ordered user/assistant pairs, current turn, rollback payload with branch context, explicit branch draft, branch switch, branch rename validation, and accessible icon controls.

```ts
expect(onCheckout).toHaveBeenCalledWith({
  sessionId: 'session-1',
  branchId: 'branch-main',
  documentId: 'turn-1',
});
```

- [ ] Run focused test; expect missing component.
- [ ] Render the active path without nested cards. Emit events only; keep IPC/state in the workbench. Use Material Symbols and non-color current-state cues.
- [ ] Re-run; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
git commit -m "feat(renderer): add analysis conversation timeline"
```

## Task 18: Workbench Integration

**Files:** `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`, `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`, `apps/desktop/src/renderer/components/code-analysis/index.ts`

- [ ] Replace `creates separate selectable records for subsequent analyses` with a failing test that sends twice and expects one session, two visible turns, and the second `runTurn` payload to reuse `sessionId`.
- [ ] Add failing tests for unpersisted project/local drafts, one-draft-at-a-time replacement, unsent-text leave confirmation, management commands, delete-to-adjacent/empty navigation, checkout then auto-fork, explicit `forceFork`, switch/rename branch, stale response guards, and annotation/source focus.
- [ ] Run workbench tests; expect old replacement behavior.
- [ ] Add renderer-only draft state:

```ts
type DraftConversation = {
  projectId: string | null;
  parentDocumentId?: string;
  forceFork: boolean;
};
```

- [ ] First send omits `sessionId`; later sends reuse it. Explicit branch persists only on send. Allow one draft at a time and confirm before discarding non-empty unsent text. Reload session detail after writes; after delete select the next session, previous session, or empty state. Hold `activeAnnotationId`; disable archived/running writes.
- [ ] Run workbench/component tests and type-check; expect PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/components/code-analysis/index.ts
git commit -m "feat(renderer): integrate multi-turn analysis sessions"
```

## Task 19: Final Ownership Migration

**Files:** `apps/desktop/src/main/db/code-analysis-migration.ts`, `apps/desktop/src/main/db/client.ts`, `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`

- [ ] Write failing tests for legacy -> v1 -> v2, existing v1 -> v2, fresh -> v2, repeat restart, and a transitional unowned document. After v2, repeat all Task 1 ownership/parent-cycle trigger assertions. Final migration must backfill it, remove `project_id`, make session/branch non-null, remain idempotent, and pass `foreign_key_check`.
- [ ] Run migration tests; expect compatibility-column failure.
- [ ] Add schema version v2: require `app_settings.code_analysis_session_schema = 1` and the v1 shape, backfill null ownership, rebuild documents without `project_id`, require session/branch FKs, rename the new table, then recreate document ownership and recursive parent-cycle triggers before `foreign_key_check`. Write marker value `2` inside the successful transaction; rollback preserves value `1`. Fresh creation writes value `2` only after final tables/triggers exist.
- [ ] Re-run; expect legacy, transitional, rollback, idempotency, and final-shape tests PASS.
- [ ] Commit:

```bash
git add apps/desktop/src/main/db/code-analysis-migration.ts apps/desktop/src/main/db/client.ts apps/desktop/src/main/db/test/test_code-analysis-migration.ts
git commit -m "refactor(db): finalize analysis turn ownership"
```

## Task 20: Final Drizzle Ownership

**Files:** `apps/desktop/src/main/db/schema.ts`, `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`, `apps/desktop/src/main/db/client.test.ts`

- [ ] Tighten failing tests: no document `projectId`, non-null session/branch, and direct unowned insert rejection.
- [ ] Run schema/client tests; expect transitional declaration failure.
- [ ] Remove compatibility `projectId`; make session/branch non-null; update final table/index inventory.
- [ ] Re-run tests and desktop type-check; expect PASS and no production `analysis_documents.project_id` query.
- [ ] Commit:

```bash
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/services/code-analysis/test/test_schema.ts apps/desktop/src/main/db/client.test.ts
git commit -m "refactor(db): require session-owned analysis turns"
```

## Task 21: Playwright Electron Harness

**Files:** `apps/desktop/package.json`, `pnpm-lock.yaml`, new `apps/desktop/playwright.config.ts`

- [ ] Add `@playwright/test`, `"test:e2e": "playwright test --pass-with-no-tests"`, Electron project, one worker, trace on first retry, and screenshot on failure.
- [ ] Run `pnpm install` then `pnpm --filter @ai-reader/desktop test:e2e`; expect exit `0` with no tests.
- [ ] Run `pnpm exec electron-builder install-app-deps` and desktop build; expect exit `0`.
- [ ] Commit:

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/playwright.config.ts
git commit -m "test(desktop): add electron playwright harness"
```

## Task 22: End-To-End Workflow

**Files:** new `apps/desktop/e2e/conversation-branching.spec.ts`, new `apps/desktop/e2e/support/mock-llm-server.ts`, `apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts`

- [ ] Implement `startMockLLMServer()` on `127.0.0.1` port `0`; return `{ baseUrl, requests, close }`, serve deterministic `/v1/chat/completions`, and close it in `test.afterEach`.
- [ ] Launch Electron with temporary `--user-data-dir`, `LLM_API_KEY=test`, `LLM_MODEL=test-model`, and `LLM_BASE_URL=<baseUrl>/v1`; close Electron and remove the profile in `afterEach`.
- [ ] Test: project draft creates no persisted session; two sends create one session/two turns and concatenated context; rollback plus send creates a branch; original remains selectable.
- [ ] Continue: annotate formatted Markdown; source mark opens annotation; source link focuses mark; rename/archive/restore/delete; restart and verify persistence/deletion/cleanup retry.
- [ ] Update service E2E with the same database invariants and current-turn export.
- [ ] Run:

```bash
pnpm rebuild better-sqlite3
pnpm --filter @ai-reader/desktop test -- src/main/services/code-analysis/test/test_e2e-flow.ts
pnpm exec electron-builder install-app-deps
pnpm --filter @ai-reader/desktop test:e2e -- conversation-branching.spec.ts
```

- [ ] Expected: both PASS; any failure blocks final verification.
- [ ] Commit:

```bash
git add apps/desktop/e2e/conversation-branching.spec.ts apps/desktop/e2e/support/mock-llm-server.ts apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts
git commit -m "test(desktop): cover conversation branching workflow"
```

## Task 23: Final Verification

**Files:** no source changes expected.

- [ ] Node-test ABI and focused coverage:

```bash
pnpm rebuild better-sqlite3
pnpm --filter @ai-reader/desktop test -- --coverage
```

Expected: all tests PASS; changed session, branch, context, cleanup, and anchor modules reach 100% statements, branches, functions, and lines.

- [ ] Workspace tests, types, and build:

```bash
pnpm test
pnpm --filter @ai-reader/desktop type-check
pnpm build
```

Expected: all commands exit `0`.

- [ ] Electron ABI and E2E:

```bash
pnpm exec electron-builder install-app-deps
pnpm --filter @ai-reader/desktop test:e2e
```

Expected: all E2E tests PASS.

- [ ] Design and safety:

```powershell
if (Test-Path DESIGN.md) { npx designmd lint DESIGN.md } else { Write-Output 'DESIGN.md not present; using component assertions and manual M3 review' }
git diff --check
git status --short
```

Expected: design lint passes when available; diff check passes; only intentional changes remain. Manually verify M3/WCAG, no secrets, no absolute path leaks, parameterized SQL, managed-root cleanup, and ownership validation on every write IPC.

## Coverage Checklist

- [ ] Project and no-project folders create renderer-only drafts.
- [ ] First send persists; later sends append to the same session.
- [ ] Current-branch context is ordered, bounded, and sibling-free.
- [ ] Rename, archive, restore, confirmed delete, and global recents work.
- [ ] Checkout is non-destructive; historical and forced continuation branch correctly.
- [ ] Cleanup retries only registered managed paths.
- [ ] Source anchors relocate deterministically.
- [ ] Marks and collapsed annotations navigate both ways.
- [ ] Chinese/English UI and output language remain functional.
- [ ] Migration preserves old documents, annotations, replies, and traces.
- [ ] Current-turn export/import works without exporting the full tree.
