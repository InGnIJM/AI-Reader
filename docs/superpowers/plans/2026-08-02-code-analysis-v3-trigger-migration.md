# Code Analysis v3 Trigger Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade existing v2 code-analysis databases to v3 by atomically replacing historical ownership triggers without changing user data.

**Architecture:** v2 remains a valid upgrade baseline; v3 strictly validates the fixed branch-update trigger. `migrateToV3()` drops and recreates the six ownership/cycle triggers inside the established SQLite transaction pattern, then changes the marker only on success.

**Tech Stack:** TypeScript, better-sqlite3, SQLite trigger DDL, Vitest, pnpm.

---

## File Structure

- `apps/desktop/src/main/db/code-analysis-migration.ts`: version dispatch, v3 transaction, and v3 Trigger validation.
- `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`: legacy v2 fixture, v3 behavior, rollback, and version expectations.

### Task 1: Write the failing legacy-v2 upgrade regression

**Files:**

- Modify: `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`

- [ ] **Step 1: Add a helper that replaces the current branch-update Trigger with its historical v2 body**

```ts
function installLegacyBranchUpdateTrigger(sqlite: Database.Database): void {
  sqlite.exec(`
    DROP TRIGGER trg_analysis_branches_validate_update;
    CREATE TRIGGER trg_analysis_branches_validate_update
    BEFORE UPDATE ON analysis_branches
    BEGIN
      SELECT CASE
        WHEN NEW.parent_branch_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM analysis_branches
                          WHERE id = NEW.parent_branch_id AND session_id = NEW.session_id)
        THEN RAISE(ABORT, 'analysis branch parent session mismatch')
      END;
      SELECT CASE
        WHEN NEW.forked_from_document_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM analysis_documents
                          WHERE id = NEW.forked_from_document_id AND session_id = NEW.session_id)
        THEN RAISE(ABORT, 'analysis branch fork document session mismatch')
      END;
      SELECT CASE
        WHEN NEW.head_document_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM analysis_documents
                          WHERE id = NEW.head_document_id AND branch_id = NEW.id)
        THEN RAISE(ABORT, 'analysis branch head branch mismatch')
      END;
    END;
  `);
}
```

- [ ] **Step 2: Add the red test for an already-marked v2 database**

```ts
it('upgrades a v2 database with a legacy branch trigger to v3', () => {
  const sqlite = openMigrated(createPath());
  installLegacyBranchUpdateTrigger(sqlite);
  migrateCodeAnalysisSchema(sqlite);

  expect(
    sqlite.prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('code_analysis_session_schema'),
  ).toEqual({ value: '3' });
  const trigger = sqlite.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`,
  ).get('trg_analysis_branches_validate_update') as { sql: string };
  expect(trigger.sql.toLowerCase()).toContain(
    'new.forked_from_document_id is not old.forked_from_document_id',
  );
});
```

- [ ] **Step 3: Add red safety cases**

Using the existing main-branch/root-document/fork-branch deletion fixture, install the legacy Trigger, migrate, and assert deletion succeeds with an empty `foreign_key_check`. Separately assert a cross-session `forked_from_document_id` update still throws `/fork document/i`; a second migration call is idempotent; and a forced `beforeCommit` failure restores marker `2`, the original Trigger SQL, preserved row counts, and `foreign_keys = ON`.

- [ ] **Step 4: Prove RED**

Run:

```bash
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts
```

Expected: the marker assertion fails because v2 returns without rebuilding its Trigger.

### Task 2: Implement atomic v2-to-v3 Trigger replacement

**Files:**

- Modify: `apps/desktop/src/main/db/code-analysis-migration.ts`

- [ ] **Step 1: Expand version dispatch and send v2 through v3**

```ts
const SESSION_SCHEMA_VERSION = '3';

if (schemaVersion === '3') {
  validateV3Schema(sqlite);
  restoreForeignKeys(sqlite);
  return;
}
if (schemaVersion === undefined || schemaVersion === '0') {
  migrateToV1(sqlite, options);
}
migrateToV2(sqlite, options);
migrateToV3(sqlite, options);
```

Allow marker `'3'` in the version predicate and update the newer-version error to `supported version is 3`. Keep `validateV2Schema()` permissive enough to accept the historical Trigger because it is the v3 migration precondition.

- [ ] **Step 2: Add the transactional migration**

```ts
function migrateToV3(sqlite: Database.Database, options: CodeAnalysisMigrationOptions): void {
  validateV2Schema(sqlite);
  const preservedCounts = snapshotPreservedCounts(sqlite);
  try {
    sqlite.pragma('foreign_keys = OFF');
    if (sqlite.pragma('foreign_keys', { simple: true }) !== 0) {
      throw new Error('Failed to disable SQLite foreign key enforcement');
    }
    sqlite.exec('BEGIN IMMEDIATE');
    dropExistingTriggers(sqlite);
    createCurrentOwnershipAndCycleTriggers(sqlite);
    options.beforeCommit?.();
    const foreignKeyErrors = sqlite.pragma('foreign_key_check') as unknown[];
    if (foreignKeyErrors.length > 0) {
      throw new Error(`Code analysis migration failed foreign key check: ${JSON.stringify(foreignKeyErrors)}`);
    }
    assertPreservedCounts(sqlite, preservedCounts);
    writeSchemaVersion(sqlite, '3');
    sqlite.exec('COMMIT');
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec('ROLLBACK');
    throw error;
  } finally {
    restoreForeignKeys(sqlite);
  }
}
```

Rename the current `createV2Triggers()` to `createCurrentOwnershipAndCycleTriggers()` and use it from both v2 and v3 migrations so there is one source of Trigger SQL.

- [ ] **Step 3: Add strict v3 Trigger validation**

```ts
const REQUIRED_V3_BRANCH_UPDATE_FRAGMENTS = [
  'new.parent_branch_id is not old.parent_branch_id',
  'new.forked_from_document_id is not old.forked_from_document_id',
  'new.head_document_id is not old.head_document_id',
  'new.session_id is not old.session_id',
] as const;

function validateV3Schema(sqlite: Database.Database): void {
  validateV2Schema(sqlite);
  const row = sqlite.prepare(
    `SELECT sql FROM sqlite_master WHERE type = 'trigger'
     AND name = 'trg_analysis_branches_validate_update'`,
  ).get() as { sql: string | null } | undefined;
  const sql = row?.sql?.toLowerCase().replace(/\s+/g, ' ') ?? '';
  if (REQUIRED_V3_BRANCH_UPDATE_FRAGMENTS.some((fragment) => !sql.includes(fragment))) {
    throw new Error('Invalid v3 schema: stale trigger trg_analysis_branches_validate_update');
  }
}
```

Update existing migrated/reopened marker expectations from `'2'` to `'3'`, and change the future-version fixture from `'3'` to `'4'`.

- [ ] **Step 4: Prove GREEN**

Run:

```bash
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts
```

Expected: upgrade, deletion, integrity, idempotency, rollback, and invalid-v3 tests pass.

### Task 3: Verify integration, coverage, and commit

**Files:**

- Modify only the two files above.

- [ ] **Step 1: Run migration and deletion integration tests**

```bash
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts src/main/services/code-analysis/test/test_session-service.ts
```

Expected: all normal and historical fork-session deletion paths pass.

- [ ] **Step 2: Run changed-module coverage and type checking**

```bash
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop exec vitest run src/main/db/test/test_code-analysis-migration.ts --coverage --coverage.include=src/main/db/code-analysis-migration.ts
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop type-check
```

Expected: new migration paths are 100% covered and both commands exit `0`.

- [ ] **Step 3: Run full desktop tests and commit the implementation**

Run the complete desktop test suite with coverage. Then inspect the working tree, stage exactly `code-analysis-migration.ts` and `test_code-analysis-migration.ts`, and commit with message `fix(desktop): migrate legacy analysis triggers to v3`.

```bash
pnpm --store-dir E:\\.pnpm-store --filter @ai-reader/desktop test -- --coverage
```

Expected: all desktop tests pass and the implementation commit contains only the migration and its regression test.

## Plan Self-Review

- **Spec coverage:** Task 1 reproduces the persisted v2 defect; Task 2 upgrades and validates v3 atomically; Task 3 proves data integrity, deletion behavior, coverage, types, and suite safety.
- **Placeholder scan:** No TODOs, deferred steps, or unspecified dependencies remain.
- **Type consistency:** The plan uses the repository's existing `Database.Database`, `CodeAnalysisMigrationOptions`, `migrateCodeAnalysisSchema`, `snapshotPreservedCounts`, and `writeSchemaVersion` conventions.
