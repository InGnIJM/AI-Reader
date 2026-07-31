# Project Memory

- Trigger: a filesystem path is used as persistent project identity.
  Action: normalize it for the platform, store a stable hash under a unique index, and merge legacy duplicates before enabling the constraint.
- Trigger: `better-sqlite3` is used by both Node/Vitest and Electron in the same workspace.
  Action: rebuild it for Node before Vitest, and rebuild it for Electron before dev, E2E, or packaging; bind both switches to package lifecycle scripts instead of relying on manual command order.
- Trigger: a project tree needs both global recents and complete per-project session history.
  Action: keep those as separate data sources; never derive a project's children from a globally limited recent-session query.
- Trigger: Playwright launches the Electron app against persistent storage.
  Action: pass a unique temporary `--user-data-dir` to every test launch and assert `app.getPath('userData')` resolves to it before running workflows.
- Trigger: multiple independently scrollable lists share a fixed-height sidebar.
  Action: constrain each list's parent track with `minmax(0, ...)` or an equivalent flex basis; `overflow-y: auto` on the child alone does not keep later sections visible.
- Trigger: a sidebar switches asynchronously between active and archived session collections.
  Action: version requests by status, clear stale visible buckets on switch, and reject late responses whose captured status no longer matches the current status.
- Trigger: a restored multi-turn conversation supports actions scoped to an individual assistant turn.
  Action: restore state from `activeDocumentId`, then switch the scoped document from the selected message's document ID instead of assuming the final returned turn is current.
- Trigger: an `Export MD` / `Export JSON` button invokes an IPC that returns content but never writes a file.
  Action: keep the serializer in the service (`exportDocument(documentId, format)` returns a `{ defaultFileName, content }` artifact), and route saving through one generic `dialog:saveFile` channel that opens the save dialog and writes disk; new formats only add a serializer case and a button, never another save path.
- Trigger: adding a new exported type in `packages/shared/src/ipc/types.ts` that consumers cannot resolve even after `pnpm --filter @ai-reader/shared build`.
  Action: shared re-exports types via an explicit enum list, not `export *`; add the new name to BOTH `packages/shared/src/ipc/index.ts` and `packages/shared/src/index.ts` before rebuilding.
- Trigger: `pnpm --filter @ai-reader/desktop test` fails in the `pretest` step with `EBUSY`/`EPERM` on `better_sqlite3.node`, then every DB test fails with `Cannot read properties of undefined (reading 'close')`.
  Action: an AI-Reader dev instance is still holding the native binary; kill the leftover `electron.exe` (check with `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`, they carry `--app-path=apps\desktop`) and rebuild before re-running tests.
- Trigger: a markdown renderer maps rendered selection offsets back to source offsets.
  Action: measure plain-text offsets with a TreeWalker over text nodes using `Range.compareBoundaryPoints`, skipping whitespace-only text nodes ReactMarkdown emits between block elements. Never use `Range.toString().length` (Chromium inserts `\n` at block boundaries, jsdom does not) and never rely on `compareDocumentPosition` for text-vs-ancestor-element comparisons (jsdom misreports the flags) — both diverge from the mdast segment space in production while all jsdom tests still pass.
