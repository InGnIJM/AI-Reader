# Project Memory

- Trigger: a filesystem path is used as persistent project identity.
  Action: normalize it for the platform, store a stable hash under a unique index, and merge legacy duplicates before enabling the constraint.
- Trigger: `better-sqlite3` tests report a Node ABI mismatch in this Electron app.
  Action: keep pure unit coverage under Vitest and run database migration checks with Electron's Node runtime.
