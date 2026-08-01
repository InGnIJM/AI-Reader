# Independent Session Forks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly created conversation forks standalone session copies, fix deletion of legacy forked sessions, and expose session- and turn-level fork controls.

**Architecture:** A new session-service transaction clones the selected document's parent chain, its tool traces, annotations, and discussion messages into a new session containing one main branch. The copy has no reference to source session data. Legacy same-session branches stay readable, while column-sensitive trigger checks allow their foreign-key cascades to finish.

**Tech Stack:** Electron IPC, React 19, TypeScript, SQLite/better-sqlite3, Vitest, Testing Library.

---

### Task 1: Define the independent-fork contract

**Files:**

- Modify: `packages/shared/src/ipc/channels.ts`, `packages/shared/src/ipc/types.ts`, `packages/shared/src/ipc/index.ts`
- Test: `packages/shared/src/ipc/test/test_code-analysis-session-types.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('exposes the independent session fork contract', () => {
  const payload: CodeAnalysisForkSessionPayload = {
    sessionId: 'session-1',
    documentId: 'turn-2',
  };
  expect(payload).toEqual({ sessionId: 'session-1', documentId: 'turn-2' });
  expect(IPC_CHANNELS.CODE_ANALYSIS_FORK_SESSION).toBe('codeAnalysis:forkSession');
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @ai-reader/shared test -- test_code-analysis-session-types.ts`

Expected: the payload and channel are missing.

- [ ] **Step 3: Add the minimal contract**

```ts
export interface CodeAnalysisForkSessionPayload {
  sessionId: string;
  documentId: string;
}

CODE_ANALYSIS_FORK_SESSION: 'codeAnalysis:forkSession',
```

Export the payload from both IPC barrels.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @ai-reader/shared test -- test_code-analysis-session-types.ts`

```bash
git add packages/shared/src/ipc/channels.ts packages/shared/src/ipc/types.ts packages/shared/src/ipc/test/test_code-analysis-session-types.ts
git commit -m "feat(shared): add independent session fork contract"

git add packages/shared/src/ipc/index.ts
git commit -m "chore(shared): export session fork contract"
```

### Task 2: Fix deletion of legacy forked sessions

**Files:**

- Modify: `apps/desktop/src/main/db/code-analysis-migration.ts`
- Test: `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`, `apps/desktop/src/main/services/code-analysis/test/test_session-service.ts`

- [ ] **Step 1: Write failing regression tests**

Seed a main branch, root document, child document, and legacy fork branch whose `forked_from_document_id` targets the root. Assert deletion succeeds while existing cross-session ownership mutation still throws:

```ts
await expect(service.deletePermanently(sessionId, true)).resolves.toEqual({ cleanupPending: false });
expect(sessionRowCount(db)).toBe(0);
expect(() => moveToSessionTwo(forkDocumentDb)).toThrow(/fork document/i);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @ai-reader/desktop test -- test_session-service.ts test_code-analysis-migration.ts`

Expected: the new deletion test throws `analysis branch fork document session mismatch`.

- [ ] **Step 3: Narrow only the trigger checks affected by changed fields**

In both migration trigger definitions, run fork ownership validation only if the fork document or session changes:

```sql
WHEN (NEW.forked_from_document_id IS NOT OLD.forked_from_document_id
      OR NEW.session_id IS NOT OLD.session_id)
  AND NEW.forked_from_document_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM analysis_documents
    WHERE id = NEW.forked_from_document_id AND session_id = NEW.session_id
  )
THEN RAISE(ABORT, 'analysis branch fork document session mismatch')
```

Use the same `OLD`/`NEW` change guard for parent and head checks. Keep checks active when their fields or `session_id` change.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @ai-reader/desktop test -- test_session-service.ts test_code-analysis-migration.ts`

```bash
git add apps/desktop/src/main/db/code-analysis-migration.ts apps/desktop/src/main/db/test/test_code-analysis-migration.ts apps/desktop/src/main/services/code-analysis/test/test_session-service.ts
git commit -m "fix(desktop): allow deleting legacy forked sessions"
```

### Task 3: Clone a session transactionally

**Files:**

- Modify: `apps/desktop/src/main/services/code-analysis/session-service.ts`
- Test: `apps/desktop/src/main/services/code-analysis/test/test_session-service.ts`

- [ ] **Step 1: Write failing service tests**

Create a session with a two-turn path, tool trace, annotation, and discussion message. Test the desired service API:

```ts
const clone = await service.forkAsIndependentSession({ sessionId, documentId: secondTurnId });
const detail = await service.getDetail(clone.id);

expect(detail?.session.title).toBe('Test Session · Branch');
expect(detail?.turns.map((turn) => turn.goal)).toEqual(['First', 'Second']);
expect(detail?.branches).toHaveLength(1);
expect(detail?.branches[0]).toMatchObject({ parentBranchId: null, forkedFromDocumentId: null });
```

Assert copied trace/annotation/message foreign keys are new IDs, source deletion leaves the clone intact, clone deletion leaves source intact, and an out-of-session document produces `INVALID_OWNERSHIP` without creating rows.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @ai-reader/desktop test -- test_session-service.ts`

Expected: `forkAsIndependentSession` is missing.

- [ ] **Step 3: Implement the minimal deep copy**

Add this public service API:

```ts
async forkAsIndependentSession(input: {
  sessionId: string;
  documentId: string;
}): Promise<AnalysisSession>
```

In one `BEGIN IMMEDIATE` transaction: validate source ownership; walk `parent_document_id` to root and reverse the path; insert a new active session titled `${source.title} · Branch`; insert one main branch with null lineage; clone path documents with remapped IDs and parents; clone related tool traces, annotations, and discussion messages through ID maps; set cloned branch head and session active pointers; commit. Roll back every failure. Do not copy cleanup queue records and do not retain any source foreign key.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @ai-reader/desktop test -- test_session-service.ts`

```bash
git add apps/desktop/src/main/services/code-analysis/session-service.ts apps/desktop/src/main/services/code-analysis/test/test_session-service.ts
git commit -m "feat(desktop): fork conversations into independent sessions"
```

### Task 4: Expose the service through IPC

**Files:**

- Modify: `apps/desktop/src/main/ipc/code-analysis.ts`, `apps/desktop/src/preload/index.ts`
- Test: `apps/desktop/src/main/ipc/test_code-analysis.test.ts`, `apps/desktop/src/preload/test/test_fallback-ipc-channels.ts`

- [ ] **Step 1: Write failing bridge tests**

Assert `codeAnalysis:forkSession` forwards `{ sessionId, documentId }` to `sessionService.forkAsIndependentSession`, and preload returns its `AnalysisSession` result.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @ai-reader/desktop test -- test_code-analysis.test.ts test_fallback-ipc-channels.ts`

Expected: no handler or preload method exists.

- [ ] **Step 3: Add the handler and bridge**

```ts
ipcMain.handle(IPC_CHANNELS.CODE_ANALYSIS_FORK_SESSION, async (_event, payload) =>
  handle('codeAnalysis:forkSession', () => deps.sessionService.forkAsIndependentSession(payload)),
);

forkSession: (payload: CodeAnalysisForkSessionPayload) =>
  invoke<AnalysisSession>(IPC_CHANNELS.CODE_ANALYSIS_FORK_SESSION, payload),
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @ai-reader/desktop test -- test_code-analysis.test.ts test_fallback-ipc-channels.ts`

```bash
git add apps/desktop/src/main/ipc/code-analysis.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc/test_code-analysis.test.ts
git commit -m "feat(desktop): expose independent session forks over ipc"
```

### Task 5: Show fork controls and navigate to the clone

**Files:**

- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`, `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css`, `apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx`, `apps/desktop/src/renderer/pages/code-analysis-i18n.ts`
- Test: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`, `apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert session-level action uses the active document and per-turn action passes every clicked turn, including the final turn:

```ts
expect(window.api.codeAnalysis.forkSession).toHaveBeenCalledWith({
  sessionId: 'session-1',
  documentId: 'active-turn',
});
```

Assert session control disables while running or without an active document, and the returned session becomes selected.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench.tsx test_ConversationTimeline.tsx`

Expected: workbench has no session-level action, does not mount the timeline, and no independent-fork callback exists.

- [ ] **Step 3: Implement shared renderer behavior**

Add `forkSessionAt(documentId)` in the workbench. It calls preload, inserts the result into the correct active session collection, increments its project count, and calls `selectSession(clone)`. Render a Material Symbols `fork_right` session action using a new `createBranch` label. Mount `ConversationTimeline` in the session view and pass `turn.id` to that shared action. Show its fork action for every turn; retain legacy checkout controls for existing branches.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench.tsx test_ConversationTimeline.tsx`

```bash
git add apps/desktop/src/renderer/components/code-analysis/ConversationTimeline.tsx apps/desktop/src/renderer/components/code-analysis/test/test_ConversationTimeline.tsx apps/desktop/src/renderer/pages/code-analysis-i18n.ts
git commit -m "feat(desktop): add conversation fork controls"

git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
git commit -m "feat(desktop): navigate to forked sessions"
```

### Task 6: Verify the complete change

**Files:** Verify only.

- [ ] **Step 1: Type check**

Run: `pnpm --filter @ai-reader/desktop type-check`

Expected: exit code 0.

- [ ] **Step 2: Run coverage**

Run: `pnpm --filter @ai-reader/desktop test -- --coverage && pnpm --filter @ai-reader/shared test -- --coverage`

Expected: all tests pass and changed core paths reach 100% coverage.

- [ ] **Step 3: Inspect final scope**

Run: `git diff --check main~5..HEAD && git status --short`

Expected: no whitespace errors and no unexpected files.
