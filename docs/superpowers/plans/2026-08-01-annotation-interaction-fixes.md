# Annotation Interaction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair comment deletion, collapse behavior, document-synchronised comments, and source-highlight navigation.

**Architecture:** Keep document activation in `CodeAnalysisWorkbench`, present and navigate annotation cards in `AnnotationSidebar`, and preserve IPC compatibility in preload. Each defect receives a behaviour-level regression test before its production change.

**Tech Stack:** Electron preload IPC, React 19, TypeScript, CSS Modules, Vitest and Testing Library.

---

### Task 1: Guard deletion and collapse behaviour

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/components/code-analysis/AnnotationSidebar.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`
- Test: `apps/desktop/src/renderer/components/code-analysis/test/test_AnnotationSidebar.tsx`

- [ ] **Step 1: Write failing tests**

Add tests proving that the first header click leaves a newly active card collapsed, the delete action exposes an accessible destructive label, and the delete control invokes its callback.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @ai-reader/desktop exec vitest run src/renderer/components/code-analysis/test/test_AnnotationSidebar.tsx`

Expected: the first-collapse regression fails before the state handling changes.

- [ ] **Step 3: Implement the minimal fix**

Add `CODE_ANALYSIS_DELETE_ANNOTATION` to the preload fallback map. Decouple sidebar header toggling from activation, track card headers by annotation id, and make the delete action a visible, focusable danger button layered above the header.

- [ ] **Step 4: Verify tests pass**

Run the command from Step 2. Expected: all sidebar tests pass.

### Task 2: Synchronise visible articles and comment cards

**Files:**
- Modify: `apps/desktop/src/renderer/components/code-analysis/AnalysisMarkdownViewer.tsx`
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`
- Test: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: Write failing tests**

Add tests showing that making a non-current assistant document visible loads that document's comments, and clicking an annotation mark scrolls and focuses the corresponding sidebar card.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @ai-reader/desktop exec vitest run src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

Expected: automatic document switch and sidebar-card navigation assertions fail before implementation.

- [ ] **Step 3: Implement the minimal fix**

Report document visibility from each rendered assistant document. Promote the visible document through the existing request-sequence guard and load its traces and comments. On source highlight activation, set the active id; the sidebar expands, scrolls, and focuses the matching card.

- [ ] **Step 4: Verify tests pass**

Run the command from Step 2. Expected: all workbench tests pass.

### Task 3: Full verification and commit

**Files:**
- Modify: affected implementation and test files from Tasks 1-2

- [ ] **Step 1: Run targeted coverage**

Run: `pnpm --filter @ai-reader/desktop exec vitest run --coverage src/renderer/components/code-analysis/test/test_AnnotationSidebar.tsx src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

Expected: tests pass and changed branches are covered.

- [ ] **Step 2: Run static verification**

Run: `pnpm --filter @ai-reader/desktop type-check`

Expected: exit code 0.

- [ ] **Step 3: Commit modularly**

Create commits with at most three files each, using `fix(renderer): ...` for the behavioural repairs and `test(renderer): ...` for regression coverage.
