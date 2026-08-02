# Code Analysis v3 Trigger Migration Design

## Goal

Upgrade existing code-analysis databases from schema v2 to schema v3 so that databases
created before the legacy-fork deletion fix receive the corrected SQLite ownership
triggers automatically, without changing user session data.

## Context

The code-analysis schema version is persisted in `app_settings` under the key
`code_analysis_session_schema`. The prior deletion fix changed the TypeScript SQL used
to create v2 triggers, but existing databases already marked `2` return after
`validateV2Schema()` and retain their earlier trigger definitions. During a cascading
session deletion, the old branch update trigger can revalidate an unchanged
`forked_from_document_id` after its source document has begun deletion, raising
`analysis branch fork document session mismatch`.

## Scope

### Included

- Introduce schema version `3` and migration paths from versions `0`, `1`, and `2`.
- Recreate the six ownership and cycle triggers during the v2-to-v3 migration.
- Preserve all user tables and rows while upgrading v2 to v3.
- Validate v3-specific trigger semantics at startup.
- Add regression coverage for an already-versioned v2 database containing the legacy
  trigger definition.

### Excluded

- Changing deletion service behavior or bypassing SQLite constraints.
- Rebuilding or altering application data tables during the v2-to-v3 migration.
- Repairing invalid cross-session records; valid historical data remains valid.
- Changing the IPC contract or renderer behavior.

## Version and Migration Contract

`SESSION_SCHEMA_VERSION` becomes `3`.

| Stored marker | Startup action |
| --- | --- |
| absent or `0` | Run v1 creation, v2 table migration, then v3 trigger migration. |
| `1` | Run v2 table migration, then v3 trigger migration. |
| `2` | Validate the v2 table/index baseline, then run v3 trigger migration. |
| `3` | Validate the complete v3 schema and return. |
| unsupported/newer value | Fail without modifying the database. |

The v2 baseline validation must remain tolerant of legacy trigger bodies. It exists only
to ensure the tables, columns, and indexes can be upgraded. Strict trigger-body checks
apply only after writing version `3`; otherwise a legacy v2 database would be rejected
before the repair migration could run.

## v3 Migration

`migrateToV3()` runs in `BEGIN IMMEDIATE` and has this exact order:

1. Validate that required v2 tables, columns, indexes, and trigger names exist.
2. Disable foreign-key enforcement using the established migration pattern.
3. Drop all six analysis ownership/cycle triggers.
4. Recreate the v3 ownership/cycle triggers.
5. Run `foreign_key_check` and verify preserved table row counts.
6. Write `code_analysis_session_schema = '3'`.
7. Commit; on any exception roll back and restore foreign-key enforcement.

The migration changes only `sqlite_master` trigger entries and the version marker. SQLite
DDL participates in the surrounding transaction, so partial trigger replacement cannot
be committed.

## Trigger Semantics

The corrected branch update trigger validates relationship ownership only when the
relationship being validated changes. In particular, the fork-source validation must use
this guard:

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

Equivalent change guards remain in place for `parent_branch_id` and `head_document_id`.
Cross-session reassignment and invalid branch/document ownership must still fail.

## Validation

The code will distinguish two validation levels:

- `validateV2BaseSchema()`: validates tables, required columns, indexes, and trigger
  existence only; it accepts legacy trigger definitions so v2 can be repaired.
- `validateV3Schema()`: validates the same structural requirements plus semantic SQL
  fragments proving that the v3 change guards are present in the branch-update trigger.

An existing v3 database with a manually replaced or stale trigger must fail startup with
an explicit invalid-v3-schema error instead of failing later during deletion.

## Tests

The migration tests will construct a genuine legacy v2 state by replacing the trigger
body with the pre-fix SQL while keeping the marker at `2`. They will verify:

1. Migration upgrades the marker to `3` and writes trigger SQL containing the change
   guards.
2. A legacy session with a forked branch deletes successfully after the upgrade.
3. An illegal cross-session fork-document mutation still raises the ownership error.
4. Running the v3 migration twice is idempotent.
5. A forced pre-commit failure rolls back the marker and trigger definitions, preserves
   table row counts, and restores `foreign_keys = ON`.

## Files

- `apps/desktop/src/main/db/code-analysis-migration.ts`: version dispatch, v3 migration,
  trigger recreation, and v3 validation.
- `apps/desktop/src/main/db/test/test_code-analysis-migration.ts`: v2-to-v3 regression,
  integrity, rollback, and idempotency tests.
- `apps/desktop/src/main/services/code-analysis/test/test_session-service.ts`: service
  deletion regression against the upgraded legacy fixture if existing service helpers are
  the clearest integration boundary.

## Acceptance Criteria

- An existing v2 database with a legacy branch-update trigger is upgraded to v3 on app
  startup.
- Deleting a session with historical forked branches succeeds after that upgrade.
- The same invalid cross-session ownership mutation remains rejected.
- No application data rows are changed by the v2-to-v3 migration.
- Trigger replacement and marker update are atomic and tested.
