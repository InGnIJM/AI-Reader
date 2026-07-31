# Independent Session Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared in-session branches with fully copied independent sessions, expose a tree-shaped session manager, and support cloning either a complete session or history through a selected turn.

**Architecture:** Schema version 3 makes every session a linear turn chain and uses `analysis_sessions.parent_session_id` only for navigation lineage. `AnalysisSessionCloneService` owns database record remapping while `AnalysisCloneFileStore` owns staged file copies and recovery journals. The renderer builds status-filtered session forests from flat session records and routes both clone entry points through one accessible dialog.

**Tech Stack:** Electron 33, React 19, TypeScript, SQLite, better-sqlite3, Drizzle ORM, Vitest, Testing Library, Playwright.

## Global Constraints

- User-visible branches are independent sessions; no copied record may retain a content foreign key to its source session.
- A full clone copies turns, Markdown, annotations, discussion messages, tool traces, and generated files.
- A through-turn clone copies the root-to-selected-turn prefix and all data attached to those copied turns.
- Deleting a session reparents direct children to the deleted session's parent in the same `BEGIN IMMEDIATE` transaction.
- Archived or running sessions cannot be cloned.
- Existing version 2 data must migrate losslessly and migration failure must leave version 2 usable.
- Use parameterized SQL and derive all filesystem paths from trusted generated IDs.
- Keep every commit to no more than 3 files.
- Use TDD: write the failing test, observe failure, implement the minimum behavior, then rerun.
- Core changed modules must reach 100% statements, branches, functions, and lines.
- Do not run the Electron app during Tasks 2-13; those tasks form one schema cutover batch.
- Execute Tasks 19-21 as one legacy-contract cleanup batch; run the full desktop type-check only after Task 21.
- Before Node/Vitest database tests, stop the Electron dev process with user confirmation and run `pnpm --filter @ai-reader/desktop rebuild:native:node`.
- Before Electron E2E or development startup, run `pnpm --filter @ai-reader/desktop rebuild:native:electron`.

---

### Task 1: Add Transitional Independent-Session IPC Contracts

**Files:**
- Modify: `packages/shared/src/ipc/types.ts`
- Modify: `packages/shared/src/ipc/channels.ts`
- Test: `packages/shared/src/ipc/test/test_code-analysis-session-types.ts`
- Modify: `packages/shared/src/ipc/index.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `CodeAnalysisCloneSessionPayload`, `CodeAnalysisCloneSessionResult`, `CodeAnalysisCloneProgress`
- Produces: `IPC_CHANNELS.CODE_ANALYSIS_CLONE_SESSION` and `IPC_CHANNELS.CODE_ANALYSIS_CLONE_PROGRESS`
- Produces transitional optional `AnalysisSession.parentSessionId` and `AnalysisSession.headDocumentId`
- Produces transitional optional `CodeAnalysisRunTurnPayload.expectedHeadDocumentId`
- Keeps legacy branch fields until Task 21 so the pre-cutover code remains type-checkable
- Re-exports all clone contracts from both shared package barrels

- [ ] **Step 1: Write failing contract tests**

```ts
const clonePayload: CodeAnalysisCloneSessionPayload = {
  requestId: 'clone-request-1',
  sourceSessionId: 'session-source',
  throughDocumentId: 'turn-2',
  title: 'Source - Branch 1',
};

const progress: CodeAnalysisCloneProgress = {
  requestId: clonePayload.requestId,
  stage: 'copying-files',
};

expect(IPC_CHANNELS.CODE_ANALYSIS_CLONE_SESSION).toBe('codeAnalysis:cloneSession');
expect(IPC_CHANNELS.CODE_ANALYSIS_CLONE_PROGRESS).toBe('codeAnalysis:cloneProgress');
expect(progress.stage).toBe('copying-files');
```

- [ ] **Step 2: Run the contract test and observe failure**

Run:

```powershell
pnpm --filter @ai-reader/shared exec vitest run src/ipc/test/test_code-analysis-session-types.ts
```

Expected: FAIL because clone contracts and channels do not exist.

- [ ] **Step 3: Add the transitional contracts**

```ts
export interface CodeAnalysisCloneSessionPayload {
  requestId: string;
  sourceSessionId: string;
  throughDocumentId?: string;
  title?: string;
}

export interface CodeAnalysisCloneSessionResult {
  session: AnalysisSession;
  turns: AnalysisTurn[];
}

export interface CodeAnalysisCloneProgress {
  requestId: string;
  stage: 'preparing' | 'copying-files' | 'writing-database' | 'finalizing';
}
```

Add optional `parentSessionId`, `headDocumentId`, and `expectedHeadDocumentId` without removing legacy fields yet.

- [ ] **Step 4: Run shared tests**

```powershell
pnpm --filter @ai-reader/shared exec vitest run src/ipc/test/test_code-analysis-session-types.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract definitions**

```powershell
git add packages/shared/src/ipc/types.ts packages/shared/src/ipc/channels.ts packages/shared/src/ipc/test/test_code-analysis-session-types.ts
git commit -m "feat(shared): add independent session clone contracts"
```

- [ ] **Step 6: Export the new contracts from both package barrels**

Add `CodeAnalysisCloneSessionPayload`, `CodeAnalysisCloneSessionResult`, and
`CodeAnalysisCloneProgress` to `packages/shared/src/ipc/index.ts` and
`packages/shared/src/index.ts`.

Run:

```powershell
pnpm --filter @ai-reader/shared exec tsc --noEmit
```

Expected: PASS and consumers can import the clone contracts from `@ai-reader/shared`.

- [ ] **Step 7: Commit the barrel exports**

```powershell
git add packages/shared/src/ipc/index.ts packages/shared/src/index.ts
git commit -m "feat(shared): export session clone contracts"
```

---

### Task 2: Define the Version 3 Drizzle Schema

**Files:**
- Modify: `apps/desktop/src/main/db/schema.ts`
- Create: `apps/desktop/src/main/services/code-analysis/test/test_schema-v3-declarations.ts`

**Interfaces:**
- Produces: `analysis_sessions.parent_session_id`
- Produces: `analysis_sessions.head_document_id`
- Produces: linear `analysis_documents` without `branch_id`
- Produces: `analysis_clone_operations`
- Removes final schema dependency on `analysis_branches`

- [ ] **Step 1: Add Drizzle metadata tests for the target declarations**

```ts
const sessionsConfig = getTableConfig(analysisSessions);
const documentsConfig = getTableConfig(analysisDocuments);

expect(sessionsConfig.columns.map((column) => column.name))
  .toEqual(expect.arrayContaining(['parent_session_id', 'head_document_id']));
expect(documentsConfig.columns.map((column) => column.name))
  .not.toContain('branch_id');
```

Keep `test_schema.ts` unchanged on the live version 2 database until Task 3. The new declaration
test imports only Drizzle metadata, so the target declarations can land without making the current
database bootstrap red.

- [ ] **Step 2: Run the schema test and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_schema-v3-declarations.ts
```

Expected: FAIL because the Drizzle declarations still contain `analysis_branches` and `branch_id`.

- [ ] **Step 3: Define the final Drizzle tables**

Use these final fields:

```ts
parentSessionId: text('parent_session_id').references(
  (): AnySQLiteColumn => analysisSessions.id,
  { onDelete: 'set null' },
),
headDocumentId: text('head_document_id').references(
  (): AnySQLiteColumn => analysisDocuments.id,
  { onDelete: 'set null' },
),
```

Add partial unique indexes equivalent to:

```sql
CREATE UNIQUE INDEX ux_analysis_documents_session_root
ON analysis_documents(session_id)
WHERE parent_document_id IS NULL;

CREATE UNIQUE INDEX ux_analysis_documents_parent
ON analysis_documents(parent_document_id)
WHERE parent_document_id IS NOT NULL;
```

Define `analysis_clone_operations` exactly as approved in the spec.

- [ ] **Step 4: Run the schema declaration test**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_schema-v3-declarations.ts
```

Expected: PASS while the live-database assertions continue to validate version 2.

- [ ] **Step 5: Commit the schema declaration**

```powershell
git add apps/desktop/src/main/db/schema.ts apps/desktop/src/main/services/code-analysis/test/test_schema-v3-declarations.ts
git commit -m "feat(desktop): define linear session schema"
```

---

### Task 3: Implement the Version 2 to Version 3 Migration

**Files:**
- Modify: `apps/desktop/src/main/db/code-analysis-migration.ts`
- Test: `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_schema.ts`

**Interfaces:**
- Changes: `SESSION_SCHEMA_VERSION` from `2` to `3`
- Extends: `CodeAnalysisMigrationOptions` with `generatedDocumentsPath?: string`
- Produces: idempotent v3 migration and v3 validation
- Consumes: the target schema defined in Task 2

**Cutover note:** Tasks 3-13 must be completed consecutively before running the full desktop suite or launching Electron.

- [ ] **Step 1: Add failing migration fixtures**

Create a version 2 fixture with:

```text
session-root
├─ branch-main: turn-1 -> turn-2 -> turn-3
└─ branch-child: shared turn-1 -> child-turn-2
   └─ branch-grandchild: shared turn-1 -> child-turn-2 -> grandchild-turn-3
```

Attach one annotation, two discussion messages, one tool trace, and one generated file directory to every path category.

Assert:

```ts
expect(readSchemaVersion(sqlite)).toBe('3');
expect(hasTable(sqlite, 'analysis_branches')).toBe(false);
expect(child.parentSessionId).toBe(root.id);
expect(grandchild.parentSessionId).toBe(child.id);
expect(childTurnIds).not.toContain('turn-1');
expect(foreignKeyCheck(sqlite)).toEqual([]);
```

Also add tests for:

- fresh database directly creates v3;
- repeat migration is a no-op;
- a `running` turn becomes `failed`;
- missing source directory is treated as no file artifact;
- unreadable existing source directory rolls back to v2;
- multiple roots, cross-session references, and cycles reject migration;
- `beforeCommit` failure preserves v2 and source files;
- obsolete child-only old directories are queued only after successful commit.

Replace the live-database inventory assertions in `test_schema.ts` with final v3 expectations and
add direct SQL rejection tests for:

```ts
expect(() => insertCrossProjectChild()).toThrow(/parent session project mismatch/i);
expect(() => createSessionCycle()).toThrow(/parent session cycle/i);
expect(() => insertSecondRootTurn()).toThrow();
expect(() => insertSecondChildForParent()).toThrow();
```

- [ ] **Step 2: Run the migration test and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts
```

Expected: FAIL because version 3 is unsupported.

- [ ] **Step 3: Add the v3 migration pipeline**

Implement these explicit phases:

```ts
ensureCloneOperationsTable(sqlite);
const snapshot = readV2BranchForest(sqlite);
const mapping = buildTargetScopedIdMap(snapshot);
prepareMigrationFiles(mapping, options.generatedDocumentsPath);
sqlite.exec('BEGIN IMMEDIATE');
rebuildSessionsForV3(sqlite, mapping);
rebuildDocumentsForV3(sqlite, mapping);
copyAttachedRecordsForV3(sqlite, mapping);
enqueueObsoleteV2Files(sqlite, mapping);
createV3Indexes(sqlite);
createV3Triggers(sqlite);
validateV3Schema(sqlite);
writeSchemaVersion(sqlite, '3');
markCloneOperationComplete(sqlite, mapping.operationId);
sqlite.exec('COMMIT');
```

Use `(targetSessionId, oldId)` as every one-to-many mapping key. Preserve root-session/root-turn IDs; generate new IDs for every copied child-session record.

- [ ] **Step 4: Add v3 trigger validation**

The trigger set must reject:

```text
parent session project mismatch
parent session cycle
analysis session head document mismatch
analysis turn parent session mismatch
analysis turn parent cycle
```

- [ ] **Step 5: Run migration and schema tests**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts src/main/services/code-analysis/test/test_schema.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/main/db/code-analysis-migration.ts apps/desktop/src/main/db/test/test_code-analysis-migration.ts apps/desktop/src/main/services/code-analysis/test/test_schema.ts
git commit -m "feat(desktop): migrate branches to independent sessions"
```

---

### Task 4: Add Transactional Clone File Storage

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/clone-file-store.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_clone-file-store.ts`

**Interfaces:**
- Produces: `AnalysisCloneFileStore`
- Consumes: `analysis_clone_operations`
- Manages only paths below the configured generated-documents root

- [ ] **Step 1: Write failing file-store tests**

Test:

```ts
await store.prepare({
  id: 'operation-1',
  kind: 'clone',
  sourceSessionId: 'source',
  targetSessionId: 'target',
  copies: [{ sourceDocumentId: 'turn-1', targetDocumentId: 'turn-copy-1' }],
});

expect(readFileSync(stagingDocumentPath, 'utf8')).toBe('source content');
await store.promote('operation-1');
expect(readFileSync(finalDocumentPath, 'utf8')).toBe('source content');
```

Cover missing source directories, path traversal rejection, partial copy rollback, `preparing` recovery, already completed operations, cleanup of promoted files after a simulated pre-commit crash, and asynchronous deletion of `complete` journal rows.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_clone-file-store.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the file-store boundary**

```ts
export interface CloneFileCopy {
  sourceDocumentId: string;
  targetDocumentId: string;
}

export class AnalysisCloneFileStore {
  async prepare(operation: CloneFileOperation): Promise<void>;
  async promote(operationId: string): Promise<void>;
  markComplete(operationId: string): void;
  async rollback(operationId: string): Promise<void>;
  async recoverPending(): Promise<void>;
}
```

Use a staging path shaped as:

```text
<generated-root>/.clone-staging/<operation-id>/<target-document-id>/
```

Validate generated IDs before constructing paths. Copy with at most 4 concurrent directory operations.
`markComplete` must atomically change the journal row to `complete`, then schedule a
best-effort asynchronous row deletion. `recoverPending` must ignore `complete` rows
except for retrying that deletion; a failed deletion must never roll back promoted
files or a committed clone.

- [ ] **Step 4: Run the focused test with coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_clone-file-store.ts --coverage --coverage.include=src/main/services/code-analysis/clone-file-store.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/clone-file-store.ts apps/desktop/src/main/services/code-analysis/test/test_clone-file-store.ts
git commit -m "feat(desktop): add recoverable clone file storage"
```

---

### Task 5: Implement Complete and Through-Turn Session Cloning

**Files:**
- Create: `apps/desktop/src/main/services/code-analysis/session-clone-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_session-clone-service.ts`
- Modify: `apps/desktop/src/main/services/code-analysis/index.ts`

**Interfaces:**
- Produces: `AnalysisSessionCloneService.clone(payload, onProgress?)`
- Consumes: `AnalysisCloneFileStore`
- Produces: `CodeAnalysisCloneSessionResult`
- Exports both clone services from `services/code-analysis/index.ts`

- [ ] **Step 1: Write the failing clone-service tests**

Full clone assertion:

```ts
const result = await service.clone({
  requestId: 'clone-full',
  sourceSessionId,
  title: 'Independent copy',
});

expect(result.session.parentSessionId).toBe(sourceSessionId);
expect(result.turns).toHaveLength(3);
expect(result.turns.map((turn) => turn.id)).not.toEqual(sourceTurnIds);
expect(copiedAnnotation.analysisDocumentId).toBe(result.turns[1].id);
expect(copiedDiscussion.annotationId).toBe(copiedAnnotation.id);
```

Through-turn assertion:

```ts
const result = await service.clone({
  requestId: 'clone-prefix',
  sourceSessionId,
  throughDocumentId: sourceTurnIds[1],
});
expect(result.turns.map((turn) => turn.goal)).toEqual(['one', 'two']);
```

Cover title generation, duplicate user title, empty source, archived source, running source, invalid ownership, source head changing during file copy, transaction rollback, file promotion failure, and all progress stages.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_session-clone-service.ts
```

Expected: FAIL because `AnalysisSessionCloneService` does not exist.

- [ ] **Step 3: Implement scoped ID remapping**

```ts
const turnIdMap = new Map<string, string>();
const annotationIdMap = new Map<string, string>();

for (const sourceTurn of sourceTurns) {
  turnIdMap.set(sourceTurn.id, randomUUID());
}

const copiedParentId = sourceTurn.parentDocumentId
  ? turnIdMap.get(sourceTurn.parentDocumentId) ?? null
  : null;
```

Insert the new session with `parent_session_id = sourceSessionId`, then copy turns, traces, annotations, and discussion messages in one `BEGIN IMMEDIATE` transaction after file preparation.

- [ ] **Step 4: Revalidate before commit**

Inside the write transaction assert:

```ts
source.status === 'active';
source.headDocumentId === snapshot.headDocumentId;
source.updatedAt === snapshot.updatedAt;
```

Return `SESSION_CHANGED` if any value differs.

- [ ] **Step 5: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_session-clone-service.ts --coverage --coverage.include=src/main/services/code-analysis/session-clone-service.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/session-clone-service.ts apps/desktop/src/main/services/code-analysis/test/test_session-clone-service.ts apps/desktop/src/main/services/code-analysis/index.ts
git commit -m "feat(desktop): clone sessions as independent copies"
```

---

### Task 6: Make Session Listing and Deletion Tree-Aware

**Files:**
- Modify: `apps/desktop/src/main/services/code-analysis/session-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_session-service.ts`

**Interfaces:**
- `listByProject` and `listRecent` return `parentSessionId` and `headDocumentId`
- `getDetail` returns a linear turn list
- `deletePermanently` reparents direct children before deleting only the selected session

- [ ] **Step 1: Add failing deletion and listing tests**

```ts
await service.deletePermanently(parentSessionId, true);

expect(await service.getDetail(parentSessionId)).toBeNull();
expect((await service.getDetail(childSessionId))!.session.parentSessionId)
  .toBe(grandparentSessionId);
expect(await service.getDetail(childSessionId)).not.toBeNull();
```

Also test deleting a top-level parent sets children to `null`, sibling sessions remain unchanged, cleanup contains only deleted-session turn paths, and a fork-shaped v2 fixture no longer raises the prior mismatch error.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_session-service.ts
```

Expected: FAIL on missing parent/head fields and child deletion behavior.

- [ ] **Step 3: Implement deletion as one immediate transaction**

```sql
UPDATE analysis_sessions
SET parent_session_id = ?
WHERE parent_session_id = ?;

UPDATE analysis_sessions
SET head_document_id = NULL
WHERE id = ?;

DELETE FROM analysis_sessions
WHERE id = ?;
```

Insert file cleanup rows before the final delete. Run `cleanup.processPending()` only after commit.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_session-service.ts --coverage --coverage.include=src/main/services/code-analysis/session-service.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/session-service.ts apps/desktop/src/main/services/code-analysis/test/test_session-service.ts
git commit -m "fix(desktop): preserve child sessions on deletion"
```

---

### Task 7: Linearize `runTurn` and Add Optimistic Head Validation

**Files:**
- Modify: `apps/desktop/src/main/services/code-analysis/service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_service.ts`

**Interfaces:**
- New session: `runTurn({ projectId, goal })`
- Existing session: `runTurn({ sessionId, expectedHeadDocumentId, goal })`
- Returns: `{ session, turn }`
- Rejects stale head with `SESSION_CHANGED`

- [ ] **Step 1: Replace branch tests with linear append tests**

```ts
const second = await service.runTurn({
  sessionId: first.session.id,
  expectedHeadDocumentId: first.turn.id,
  goal: 'second',
});

expect(second.turn.parentDocumentId).toBe(first.turn.id);
expect(second.session.headDocumentId).toBe(second.turn.id);
```

Add concurrent stale-head, archived, running, missing session, and transaction rollback cases.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_service.ts
```

Expected: FAIL because `runTurn` still creates and updates `analysis_branches`.

- [ ] **Step 3: Implement linear writes**

Within `BEGIN IMMEDIATE`:

```ts
if (payload.expectedHeadDocumentId !== session.headDocumentId) {
  throw new CodeAnalysisServiceError('SESSION_CHANGED', 'Session head changed');
}

insertTurn.run(
  turnId,
  sessionId,
  session.headDocumentId,
  payload.goal,
  now,
  now,
);
updateHead.run(turnId, now, sessionId);
```

Load prior turns from the current session and pass them to `buildMultiTurnContext`; do not query sibling sessions.
Refactor the legacy `runAnalysis({ projectId, goal })` entry point to delegate to the same
first-turn creation path so it also stops creating `analysis_branches`.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_service.ts --coverage --coverage.include=src/main/services/code-analysis/service.ts
```

Expected: PASS and 100% coverage for changed paths.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/service.ts apps/desktop/src/main/services/code-analysis/test/test_service.ts
git commit -m "refactor(desktop): linearize analysis session turns"
```

---

### Task 8: Update Import and Export for Linear Sessions

**Files:**
- Modify: `apps/desktop/src/main/services/code-analysis/export-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_export-service.ts`

**Interfaces:**
- Import creates one top-level session and one head turn
- Export remains scoped to the requested turn and its annotations
- No import/export query references `analysis_branches`

- [ ] **Step 1: Add failing import assertions**

```ts
const imported = await service.importJson(payload);
const session = readSessionForTurn(imported.id);

expect(session.parentSessionId).toBeNull();
expect(session.headDocumentId).toBe(imported.id);
expect(countRows('analysis_branches')).toBe(0);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_export-service.ts
```

Expected: FAIL because import still creates a main branch.

- [ ] **Step 3: Replace branch creation with linear session creation**

Insert session with a null head, insert the imported turn, then set `head_document_id` in the same transaction.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_export-service.ts --coverage --coverage.include=src/main/services/code-analysis/export-service.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/export-service.ts apps/desktop/src/main/services/code-analysis/test/test_export-service.ts
git commit -m "refactor(desktop): import linear analysis sessions"
```

---

### Task 9: Convert Remaining Backend Fixtures to Linear Sessions

**Files:**
- Modify: `apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts`
- Modify: `apps/desktop/src/main/services/code-analysis/test/test_service-lists.ts`

**Interfaces:**
- Replaces direct `analysis_branches` inserts with version 3 linear session fixtures
- Re-expresses cross-branch ownership tests as cross-session ownership tests
- Does not change production behavior

- [ ] **Step 1: Run the remaining backend tests and capture the expected fixture failures**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_annotations-replies.ts src/main/services/code-analysis/test/test_service-lists.ts
```

Expected: FAIL on missing `analysis_branches` or `branch_id`.

- [ ] **Step 2: Replace branch-shaped inserts**

Use the final linear fixture order:

```ts
insertSession({ id: 'session-1', headDocumentId: null });
insertTurn({
  id: 'turn-1',
  sessionId: 'session-1',
  parentDocumentId: null,
});
updateSessionHead('session-1', 'turn-1');
```

For ownership rejection, create `session-2` and point the request at a turn owned by that
session; do not recreate sibling branches.

- [ ] **Step 3: Run both suites**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_annotations-replies.ts src/main/services/code-analysis/test/test_service-lists.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/test/test_annotations-replies.ts apps/desktop/src/main/services/code-analysis/test/test_service-lists.ts
git commit -m "test(desktop): use linear analysis session fixtures"
```

---

### Task 10: Make Cleanup Remove Generated Directories Safely

**Files:**
- Modify: `apps/desktop/src/main/services/code-analysis/cleanup-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_cleanup-service.ts`

**Interfaces:**
- `processPending` recursively removes managed document directories
- No full-directory orphan scan
- `ENOENT` remains successful

- [ ] **Step 1: Add a failing nested-directory cleanup test**

```ts
mkdirSync(join(documentDir, 'nested'), { recursive: true });
writeFileSync(join(documentDir, 'nested', 'artifact.json'), '{}');

await service.processPending();

expect(existsSync(documentDir)).toBe(false);
expect(queueCount(db)).toBe(0);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_cleanup-service.ts
```

Expected: FAIL because `unlink()` cannot remove a non-empty directory.

- [ ] **Step 3: Replace `unlink` with managed recursive removal**

```ts
await rm(absPath, { recursive: true, force: false });
```

Keep `resolveManagedPath` traversal and prefix checks unchanged.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_cleanup-service.ts --coverage --coverage.include=src/main/services/code-analysis/cleanup-service.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/cleanup-service.ts apps/desktop/src/main/services/code-analysis/test/test_cleanup-service.ts
git commit -m "fix(desktop): clean generated document directories"
```

---

### Task 11: Expose Clone IPC and Progress Events

**Files:**
- Modify: `apps/desktop/src/main/ipc/code-analysis.ts`
- Test: `apps/desktop/src/main/ipc/test_code-analysis.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`

**Interfaces:**
- Main handler: `codeAnalysis:cloneSession`
- Renderer API: `cloneSession(payload)`
- Renderer subscription: `onCloneProgress(listener): () => void`
- Removes no legacy handler yet; Task 19 performs final removal

- [ ] **Step 1: Add failing handler tests**

```ts
await registeredHandler(event, payload);

expect(cloneService.clone).toHaveBeenCalledWith(
  payload,
  expect.any(Function),
);
expect(event.sender.send).toHaveBeenCalledWith(
  IPC_CHANNELS.CODE_ANALYSIS_CLONE_PROGRESS,
  { requestId: payload.requestId, stage: 'copying-files' },
);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/ipc/test_code-analysis.test.ts
```

Expected: FAIL because clone handlers are not registered.

- [ ] **Step 3: Register the handler and preload bridge**

```ts
cloneSession: (payload: CodeAnalysisCloneSessionPayload) =>
  invoke<CodeAnalysisCloneSessionResult>(
    IPC_CHANNELS.CODE_ANALYSIS_CLONE_SESSION,
    payload,
  ),
onCloneProgress: (listener: (progress: CodeAnalysisCloneProgress) => void) => {
  const wrapped = (_event: IpcRendererEvent, progress: CodeAnalysisCloneProgress) =>
    listener(progress);
  ipcRenderer.on(IPC_CHANNELS.CODE_ANALYSIS_CLONE_PROGRESS, wrapped);
  return () => ipcRenderer.removeListener(
    IPC_CHANNELS.CODE_ANALYSIS_CLONE_PROGRESS,
    wrapped,
  );
},
```

- [ ] **Step 4: Run handler tests and type-check the preload**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/ipc/test_code-analysis.test.ts
pnpm --filter @ai-reader/desktop type-check
```

Expected: handler test PASS. Type-check may still report old renderer branch usages until Task 18; no clone/preload errors may remain.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/ipc/code-analysis.ts apps/desktop/src/main/ipc/test_code-analysis.test.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): expose session cloning over ipc"
```

---

### Task 12: Wire Migration and Clone Services at Startup

**Files:**
- Modify: `apps/desktop/src/main/db/client.ts`
- Test: `apps/desktop/src/main/db/client.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- `createDatabase(dbPath, { generatedDocumentsPath? })`
- Passes generated-document root into v3 migration
- Makes the application await asynchronous handler/service initialization

- [ ] **Step 1: Add failing client bootstrap tests**

```ts
const client = createDatabase(dbPath, {
  generatedDocumentsPath,
});
expect(readSchemaVersion(client.db)).toBe('3');
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/db/client.test.ts
```

Expected: FAIL because `createDatabase` accepts only one argument.

- [ ] **Step 3: Pass the generated root through startup**

```ts
const generatedDocumentsPath = join(app.getPath('userData'), 'generated-documents');
const db = createDatabase(dbPath, { generatedDocumentsPath });
await registerAllHandlers(db, generatedDocumentsPath);
```

Change the startup callback to `app.whenReady().then(async () => { ... })` so the window is not
created before recovery and handler registration finish.

Do not derive the root twice or construct `generated-documents/generated-documents`.

- [ ] **Step 4: Run the client test**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/db/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/db/client.ts apps/desktop/src/main/db/client.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): initialize independent session storage"
```

---

### Task 13: Compose Clone and Cleanup Services

**Files:**
- Modify: `apps/desktop/src/main/ipc/index.ts`
- Test: `apps/desktop/src/main/ipc/index.test.ts`

**Interfaces:**
- Changes: `registerAllHandlers(...): Promise<void>`
- Creates one shared `AnalysisCleanupService`
- Creates one shared `AnalysisCloneFileStore`
- Injects both into `AnalysisSessionService` and `AnalysisSessionCloneService`
- Supplies `sessionCloneService` to `registerCodeAnalysisHandlers`
- Calls `await cloneFileStore.recoverPending()` before any handler is registered

- [ ] **Step 1: Add a failing composition test**

```ts
await registerAllHandlers(db, generatedDocumentsPath);
expect(recoverPending).toHaveBeenCalled();
expect(registerCodeAnalysisHandlers).toHaveBeenCalledWith(
  expect.objectContaining({
    sessionService: expect.any(AnalysisSessionService),
    sessionCloneService: expect.any(AnalysisSessionCloneService),
  }),
);
expect(recoverPending.mock.invocationCallOrder[0])
  .toBeLessThan(registerCodeAnalysisHandlers.mock.invocationCallOrder[0]);
```

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/ipc/index.test.ts
```

Expected: FAIL because clone and cleanup services are not composed.

- [ ] **Step 3: Instantiate services with one canonical root**

```ts
const userDataRoot = dirname(generatedDocumentsPath);
const cleanupService = new AnalysisCleanupService(db, userDataRoot);
const cloneFileStore = new AnalysisCloneFileStore(db, generatedDocumentsPath);
const sessionService = new AnalysisSessionService(db, cleanupService);
const sessionCloneService = new AnalysisSessionCloneService(
  db,
  cloneFileStore,
);
```

- [ ] **Step 4: Run backend cutover tests**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts src/main/services/code-analysis/test/test_schema.ts src/main/services/code-analysis/test/test_clone-file-store.ts src/main/services/code-analysis/test/test_session-clone-service.ts src/main/services/code-analysis/test/test_session-service.ts src/main/services/code-analysis/test/test_service.ts src/main/services/code-analysis/test/test_export-service.ts src/main/services/code-analysis/test/test_cleanup-service.ts src/main/ipc/test_code-analysis.test.ts src/main/ipc/index.test.ts
```

Expected: all listed backend cutover tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/ipc/index.ts apps/desktop/src/main/ipc/index.test.ts
git commit -m "feat(desktop): compose session clone services"
```

---

### Task 14: Add a Pure Session-Forest Builder

**Files:**
- Create: `apps/desktop/src/renderer/components/code-analysis/session-tree.ts`
- Test: `apps/desktop/src/renderer/components/code-analysis/test/test_session-tree.ts`

**Interfaces:**
- Produces: `SessionTreeNode`
- Produces: `buildSessionForest(sessions)`
- Sorts siblings by `updatedAt DESC`
- Promotes a node when its parent is absent from the current filtered list

- [ ] **Step 1: Write failing tree tests**

```ts
const forest = buildSessionForest([
  makeSession({ id: 'parent', parentSessionId: null }),
  makeSession({ id: 'child', parentSessionId: 'parent' }),
  makeSession({ id: 'grandchild', parentSessionId: 'child' }),
]);

expect(forest[0].children[0].children[0].session.id).toBe('grandchild');
```

Cover missing parent promotion, stable sorting, input immutability, duplicate IDs, and defensive cycle breaking.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_session-tree.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the pure builder**

```ts
export interface SessionTreeNode {
  session: AnalysisSession;
  children: SessionTreeNode[];
}

export function buildSessionForest(
  sessions: readonly AnalysisSession[],
): SessionTreeNode[];
```

Use `Map<string, SessionTreeNode>`, a visited set, and no React state.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_session-tree.ts --coverage --coverage.include=src/renderer/components/code-analysis/session-tree.ts
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/components/code-analysis/session-tree.ts apps/desktop/src/renderer/components/code-analysis/test/test_session-tree.ts
git commit -m "feat(renderer): build independent session trees"
```

---

### Task 15: Build the Shared Clone Dialog

**Files:**
- Create: `apps/desktop/src/renderer/components/code-analysis/SessionCloneDialog.tsx`
- Test: `apps/desktop/src/renderer/components/code-analysis/test/test_SessionCloneDialog.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`

**Interfaces:**
- Consumes: source session, optional through turn, suggested title, progress stage
- Produces: `onConfirm(title)` and `onCancel()`
- Used by both sidebar and timeline entry points

- [ ] **Step 1: Write failing dialog tests**

Cover:

```ts
expect(screen.getByText('Turn 1 through Turn 2')).toBeInTheDocument();
expect(onConfirm).toHaveBeenCalledWith('Source - Branch 1');
expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
```

Also test 1-80 validation, trimmed title, Escape, Tab focus trap, initial input focus, submit disabling, cancel disabling, and all four progress-stage labels.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_SessionCloneDialog.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the dialog**

Use Material Symbols, an 8px-or-less radius, and no nested cards. Keep dimensions stable while progress text changes.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_SessionCloneDialog.tsx --coverage --coverage.include=src/renderer/components/code-analysis/SessionCloneDialog.tsx
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/components/code-analysis/SessionCloneDialog.tsx apps/desktop/src/renderer/components/code-analysis/test/test_SessionCloneDialog.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
git commit -m "feat(renderer): add session clone dialog"
```

---

### Task 16: Render and Manage the Sidebar Session Tree

**Files:**
- Modify: `apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx`
- Test: `apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`
- Modify: `apps/desktop/src/renderer/components/code-analysis/index.ts`

**Interfaces:**
- Consumes: flat `AnalysisSession[]`
- Uses: `buildSessionForest`
- Produces: `onRequestCloneSession(session)`
- Keeps rename/archive/restore/delete behavior on every tree node
- Exports `SessionCloneDialog` from the component barrel for Task 18

- [ ] **Step 1: Add failing sidebar tree tests**

Test:

```ts
expect(childRow).toHaveAttribute('data-depth', '1');
await user.click(screen.getByRole('button', { name: /collapse source/i }));
expect(childRow).not.toBeVisible();
await user.click(screen.getByRole('menuitem', { name: /create branch/i }));
expect(onRequestCloneSession).toHaveBeenCalledWith(sourceSession);
```

Also cover arbitrary depth, filtered-parent promotion, recent-list parent omission, archived clone disabled, running selected session disabled, focus restoration, and delete warning text when children exist.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx
```

Expected: FAIL because sessions are rendered flat and no clone menu item exists.

- [ ] **Step 3: Render recursive tree rows**

Add:

```ts
onRequestCloneSession?: (session: AnalysisSession) => void;
```

Use semantic buttons with `aria-expanded`; cap visual indentation without flattening logical depth.
Add depth-aware indentation, ancestor connector lines, and a branch icon in
`CodeAnalysisComponents.module.css`. Preserve the existing compact row height and
verify long titles truncate without covering row actions.

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx --coverage --coverage.include=src/renderer/components/code-analysis/ProjectSidebar.tsx
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit the tree behavior and styles**

```powershell
git add apps/desktop/src/renderer/components/code-analysis/ProjectSidebar.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ProjectSidebar.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
git commit -m "feat(renderer): manage sessions as a tree"
```

- [ ] **Step 6: Export the clone dialog**

```powershell
git add apps/desktop/src/renderer/components/code-analysis/index.ts
git commit -m "feat(renderer): export session clone dialog"
```

---

### Task 17: Replace Branch Controls with Through-Turn Cloning

**Files:**
- Modify: `apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx`
- Test: `apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx`

**Interfaces:**
- Removes: branch switch, checkout, and branch rename props
- Produces: `onCloneThroughTurn(turn)`
- Keeps: local `onSelectTurn(turn)` for read-only history inspection

- [ ] **Step 1: Replace old branch-control tests**

```ts
await user.click(
  within(secondTurn).getByRole('button', { name: /branch from here/i }),
);
expect(onCloneThroughTurn).toHaveBeenCalledWith(sampleTurns[1]);
```

Assert the action is shown for every completed or failed turn, including the head turn, and hidden for running/pending turns.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx
```

Expected: FAIL because the component still requires branch IDs and hides the action on the head turn.

- [ ] **Step 3: Simplify the component contract**

```ts
export interface ConversationTimelineProps {
  turns: AnalysisTurn[];
  activeTurnId?: string;
  onSelectTurn?: (turn: AnalysisTurn) => void;
  onCloneThroughTurn?: (turn: AnalysisTurn) => void;
  disabled?: boolean;
  language?: Language;
}
```

- [ ] **Step 4: Run focused coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx --coverage --coverage.include=src/renderer/components/code-analysis/ConversationTimeline.tsx
```

Expected: PASS and 100% coverage.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx
git commit -m "feat(renderer): clone sessions from selected turns"
```

---

### Task 18: Integrate Clone Workflows in the Workbench

**Files:**
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`
- Test: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/pages/code-analysis-i18n.ts`

**Interfaces:**
- Full clone request originates in `ProjectSidebar`
- Through-turn clone request originates in `ConversationTimeline`
- Both open `SessionCloneDialog`
- `runTurn` sends `expectedHeadDocumentId`
- Removes renderer branch state and branch selector

- [ ] **Step 1: Add failing integration tests**

Cover:

```ts
await user.click(screen.getByRole('menuitem', { name: /create branch/i }));
await user.click(screen.getByRole('button', { name: /create/i }));
expect(window.api.codeAnalysis.cloneSession).toHaveBeenCalledWith(
  expect.objectContaining({
    sourceSessionId: 'session-source',
    throughDocumentId: undefined,
  }),
);
```

And:

```ts
expect(window.api.codeAnalysis.cloneSession).toHaveBeenCalledWith(
  expect.objectContaining({
    sourceSessionId: 'session-source',
    throughDocumentId: 'turn-2',
  }),
);
```

Also test progress-stage filtering by request ID, stale response suppression, automatic selection of the new session, cache insertion under its parent, project count update, clone error retry, historical-turn prompt blocking, expected-head submission, and parent deletion selection rules.

- [ ] **Step 2: Run and observe failure**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
```

Expected: FAIL because the Workbench still calls checkout/switch/rename branch APIs.

- [ ] **Step 3: Replace branch state with clone-dialog state**

```ts
type CloneRequest =
  | { source: AnalysisSession; throughTurn: AnalysisTurn }
  | { source: AnalysisSession; throughTurn?: undefined };
```

Subscribe once:

```ts
useEffect(
  () => window.api.codeAnalysis.onCloneProgress((progress) => {
    if (progress.requestId === cloneRequestIdRef.current) {
      setCloneProgress(progress.stage);
    }
  }),
  [],
);
```

After clone success, update `sessions`, `localSessions`, or `sessionsByProject`, then call `selectSession(result.session)`.
Render `ConversationTimeline` in the center panel with `onSelectTurn` and
`onCloneThroughTurn`, and pass sidebar requests through
`onRequestCloneSession`. Both callbacks populate the same `CloneRequest` state
and open the same `SessionCloneDialog`.

- [ ] **Step 4: Remove branch UI state**

Remove `branches`, `activeBranchId`, `switchBranch`, `renameBranch`, `checkoutTurn`, and the center-panel branch `<select>`.

- [ ] **Step 5: Run renderer regression tests**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/renderer
```

Expected: all renderer tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/code-analysis-i18n.ts
git commit -m "feat(renderer): integrate independent session cloning"
```

---

### Task 19: Remove Legacy Main-Process Branch APIs

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/main/ipc/code-analysis.ts`
- Test: `apps/desktop/src/main/ipc/test_code-analysis.test.ts`
- Modify: `apps/desktop/src/main/ipc/index.ts`

**Interfaces:**
- Removes checkout/list/switch/rename branch handlers and preload methods
- Removes `AnalysisBranchService` from IPC composition
- Keeps clone, clone progress, session management, and run-turn APIs

- [ ] **Step 1: Remove the unused preload surface**

```powershell
rg "checkoutTurn|listBranches|switchBranch|renameBranch" apps/desktop/src/renderer
```

Expected: no renderer consumers after Task 18. Remove those methods from
`apps/desktop/src/preload/index.ts`, run
`pnpm --filter @ai-reader/desktop type-check`, then commit:

```powershell
git add apps/desktop/src/preload/index.ts
git commit -m "refactor(desktop): remove branch preload methods"
```

- [ ] **Step 2: Remove legacy handler expectations**

Add a negative assertion:

```ts
expect(registeredChannels).not.toEqual(
  expect.arrayContaining([
    'codeAnalysis:checkoutTurn',
    'codeAnalysis:listBranches',
    'codeAnalysis:switchBranch',
    'codeAnalysis:renameBranch',
  ]),
);
```

- [ ] **Step 3: Remove handlers and composition**

Remove branch imports, handlers, and dependency fields from
`main/ipc/code-analysis.ts`. Remove the `AnalysisBranchService` import,
construction, and `branchService` injection from `main/ipc/index.ts`.

Run:

```powershell
rg "AnalysisBranchService|checkoutTurn|listBranches|switchBranch|renameBranch" apps/desktop/src/main/ipc
```

Expected: no matches.

- [ ] **Step 4: Run IPC tests**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/ipc/test_code-analysis.test.ts src/main/ipc/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the main-process removal**

```powershell
git add apps/desktop/src/main/ipc/code-analysis.ts apps/desktop/src/main/ipc/test_code-analysis.test.ts apps/desktop/src/main/ipc/index.ts
git commit -m "refactor(desktop): remove branch ipc endpoints"
```

---

### Task 20: Delete the Obsolete Branch Service

**Files:**
- Delete: `apps/desktop/src/main/services/code-analysis/branch-service.ts`
- Delete: `apps/desktop/src/main/services/code-analysis/test/test_branch-service.ts`
- Modify: `apps/desktop/src/main/services/code-analysis/index.ts`

**Interfaces:**
- Removes `AnalysisBranchService`
- Ensures all history resolution uses the current session's linear turn chain

- [ ] **Step 1: Confirm no runtime consumers remain**

```powershell
rg "AnalysisBranchService|branch-service" apps/desktop/src --glob "*.ts" --glob "*.tsx"
```

Expected before deletion: only the service, its test, and barrel export remain.

- [ ] **Step 2: Delete the service and export**

Remove the two files and the barrel line:

```ts
export * from './branch-service';
```

- [ ] **Step 3: Run backend tests**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis src/main/ipc
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add apps/desktop/src/main/services/code-analysis/branch-service.ts apps/desktop/src/main/services/code-analysis/test/test_branch-service.ts apps/desktop/src/main/services/code-analysis/index.ts
git commit -m "refactor(desktop): remove shared-history branch service"
```

---

### Task 21: Finalize Shared Contracts Without Legacy Branch Types

**Files:**
- Modify: `packages/shared/src/ipc/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/ipc/types.ts`
- Modify: `packages/shared/src/ipc/channels.ts`
- Test: `packages/shared/src/ipc/test/test_code-analysis-session-types.ts`

**Interfaces:**
- Makes `parentSessionId` and `headDocumentId` required
- Removes `AnalysisBranch`
- Removes branch fields from `AnalysisSession`, `AnalysisTurn`, and `AnalysisSessionDetail`
- Removes checkout/list/switch/rename branch payloads and channels
- Makes `expectedHeadDocumentId` required for existing-session turns
- Removes legacy exports from both shared package barrels

- [ ] **Step 1: Stop exporting legacy types**

Remove `AnalysisBranch`, checkout/switch/rename payloads, and other branch-only
exports from `packages/shared/src/ipc/index.ts` and `packages/shared/src/index.ts`.
Keep all clone contracts exported.

Run:

```powershell
pnpm --filter @ai-reader/shared exec tsc --noEmit
```

Expected: PASS because no runtime consumer remains after Tasks 19-20.

- [ ] **Step 2: Commit the barrel cleanup**

```powershell
git add packages/shared/src/ipc/index.ts packages/shared/src/index.ts
git commit -m "refactor(shared): stop exporting branch contracts"
```

- [ ] **Step 3: Tighten the contract fixture**

```ts
const detail: AnalysisSessionDetail = {
  session: {
    id: 'session-1',
    projectId: null,
    parentSessionId: null,
    headDocumentId: 'turn-1',
    title: 'Session',
    status: 'active',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  },
  turns: [turn],
};
```

Remove every fixture field containing `branchId`, `activeBranchId`,
`activeDocumentId`, `parentBranchId`, or `forkedFromDocumentId`.

- [ ] **Step 4: Run and observe compile failure**

```powershell
pnpm --filter @ai-reader/shared exec vitest run src/ipc/test/test_code-analysis-session-types.ts
```

Expected: FAIL until legacy contracts are removed consistently.

- [ ] **Step 5: Remove legacy contracts and channels**

Run:

```powershell
rg "AnalysisBranch|activeBranchId|activeDocumentId|parentBranchId|forkedFromDocumentId|branchId|CHECKOUT_TURN|LIST_BRANCHES|SWITCH_BRANCH|RENAME_BRANCH" packages/shared/src/ipc
```

Expected after edit: no matches.

- [ ] **Step 6: Run shared tests and full type-check**

```powershell
pnpm --filter @ai-reader/shared exec vitest run
pnpm --filter @ai-reader/desktop type-check
```

Expected: PASS.

- [ ] **Step 7: Commit the contract definitions**

```powershell
git add packages/shared/src/ipc/types.ts packages/shared/src/ipc/channels.ts packages/shared/src/ipc/test/test_code-analysis-session-types.ts
git commit -m "refactor(shared): remove legacy branch contracts"
```

---

### Task 22: Add End-to-End Independent Session Coverage

**Files:**
- Modify: `apps/desktop/e2e/conversation-branching.spec.ts`
- Modify: `apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts`
- Modify: `MEMORY.md`

**Interfaces:**
- Verifies both clone entry points through real IPC
- Verifies parent deletion preserves child use
- Records the reusable migration/clone recovery pattern

- [ ] **Step 1: Replace shared-branch E2E expectations**

Add scenarios:

```text
1. Create a three-turn source session.
2. Clone the complete session from its sidebar menu.
3. Clone through turn two from the timeline.
4. Verify both children appear nested below the source.
5. Modify one child and verify the source remains unchanged.
6. Delete the source and verify both children become top-level.
7. Continue a child session and create a grandchild.
8. Restart Electron and verify the tree persists.
```

- [ ] **Step 2: Add a service-level E2E flow**

Assert copied annotations, discussion messages, traces, files, and LLM context are independent.

- [ ] **Step 3: Run service E2E**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run src/main/services/code-analysis/test/test_e2e-flow.ts
```

Expected: PASS.

- [ ] **Step 4: Rebuild for Electron and run Playwright**

```powershell
pnpm --filter @ai-reader/desktop rebuild:native:electron
pnpm --filter @ai-reader/desktop exec playwright test e2e/conversation-branching.spec.ts
```

Expected: PASS. If the existing Windows Electron GPU subprocess crashes before the page is available, capture the process exit evidence and verify the service-level E2E still passes; do not classify an unchanged baseline GPU crash as a feature regression.

- [ ] **Step 5: Record the reusable pattern**

Append to `MEMORY.md`:

```text
Trigger: cloning SQLite-owned records with generated filesystem artifacts.
Action: persist a trusted operation manifest before file preparation, promote files before the DB commit, mark completion in the same DB transaction, and recover only paths named by unfinished manifests.
```

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/e2e/conversation-branching.spec.ts apps/desktop/src/main/services/code-analysis/test/test_e2e-flow.ts MEMORY.md
git commit -m "test(desktop): cover independent session branching"
```

---

### Task 23: Run Final Quality Gates

**Files:**
- No source changes expected

**Interfaces:**
- Verifies the complete approved spec

- [ ] **Step 1: Scan for removed branch runtime concepts**

```powershell
rg "AnalysisBranch|active_branch_id|activeBranchId|active_document_id|activeDocumentId|parent_branch_id|parentBranchId|forked_from_document_id|forkedFromDocumentId|branch_id|branchId|forceFork|checkoutTurn|listBranches|switchBranch|renameBranch" apps/desktop/src packages/shared/src --glob "*.ts" --glob "*.tsx"
```

Expected: matches only in v2-to-v3 migration fixtures or explicit legacy migration SQL.

- [ ] **Step 2: Run shared tests**

```powershell
pnpm --filter @ai-reader/shared exec vitest run
```

Expected: PASS.

- [ ] **Step 3: Run desktop tests**

```powershell
pnpm --filter @ai-reader/desktop rebuild:native:node
pnpm --filter @ai-reader/desktop exec vitest run
```

Expected: PASS.

- [ ] **Step 4: Run changed-module coverage**

```powershell
pnpm --filter @ai-reader/desktop exec vitest run --coverage --coverage.include=src/main/db/code-analysis-migration.ts --coverage.include=src/main/services/code-analysis/clone-file-store.ts --coverage.include=src/main/services/code-analysis/session-clone-service.ts --coverage.include=src/main/services/code-analysis/session-service.ts --coverage.include=src/main/services/code-analysis/service.ts --coverage.include=src/renderer/components/code-analysis/session-tree.ts --coverage.include=src/renderer/components/code-analysis/SessionCloneDialog.tsx --coverage.include=src/renderer/components/code-analysis/ProjectSidebar.tsx --coverage.include=src/renderer/components/code-analysis/ConversationTimeline.tsx --coverage.include=src/renderer/pages/CodeAnalysisWorkbench.tsx
```

Expected: 100% statements, branches, functions, and lines for every included module.

- [ ] **Step 5: Run type-check, lint, and production build**

```powershell
pnpm --filter @ai-reader/shared exec tsc --noEmit
pnpm --filter @ai-reader/desktop type-check
pnpm lint
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 6: Run final E2E**

```powershell
pnpm --filter @ai-reader/desktop rebuild:native:electron
pnpm --filter @ai-reader/desktop test:e2e
```

Expected: PASS, subject only to a separately evidenced unchanged Electron GPU environment failure.

- [ ] **Step 7: Review working-tree scope**

```powershell
git diff --check
git status --short
git log --oneline -25
```

Expected: no whitespace errors, no generated test artifacts staged, no unrelated user changes included in feature commits, and every commit touches at most 3 files.
