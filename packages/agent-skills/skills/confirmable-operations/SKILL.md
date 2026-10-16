---
name: confirmable-operations
description: >
  Explains the SQLDev "confirm before commit" protocol and its first use, making a
  drive storage object public: PostgreSQL-issued five-minute challenges, the two
  short jobs that avoid holding the single-concurrency EC2 worker, the
  config_version revision that orders the insert-only d_storage_object_config
  history, owner-only authorization, and how to register another confirmable
  operation. Load before changing app_confirmation_* tables or functions,
  d_storage_object_config, the storage visibility RPCs, or anything that adds a new
  destructive flow that needs user confirmation.
---

# Confirmable Operations

Read this before changing the confirmation protocol or the storage visibility feature. Trust current source over this document. The spec is `.kiro/specs/storage-visibility-confirmation/` (`requirements.md`, `design.md`, `tasks.md`).

Governing skills: `understanding-sqldev` first. For SQL, follow the Supabase guidance (the `supabase` and `supabase-postgres-best-practices` skills are not installed; use the `user-postgres-dev` MCP and the migrations). For TypeScript, `tagged-unions` and `valid-state-types`.

## Why two jobs

The worker runs one DBOS workflow at a time (`packages/functions/cmd/supabaseworker/main.go`, queue `ec2-jobs`, global and worker concurrency 1). A job that waited for a human would block every other user. So waiting happens only in the browser:

1. Initiation job: validates in PostgreSQL, issues a challenge, returns `confirmation_required`, and finishes.
2. Confirmation job: a separate job that validates and consumes the challenge and appends the config row in one transaction.

Never add an `awaiting_confirmation` job status, and never park a transaction, workflow, or SQS message on user input.

## Database facts (verified against local Supabase, PostgreSQL 17.6)

- Migrations: the revision lives in the migrations that define each object (`20260829120003` table, guard and `d_storage_object_current_config`; `...005` views; `...007`/`20261007054500` `prepare_d_storage_upload`; `...009` notify trigger; `...010` `get_d_storage_objects`; `20261007054500` `d_storage_object_is_public`), plus the new `20261101090100_create_app_confirmation_protocol.sql` and `20261101090200_create_d_storage_visibility_functions.sql`. There is no separate revision migration and no backfill.
- `d_storage_object_config` is insert-only. A `BEFORE UPDATE` trigger rejects updates. `DELETE` stays possible because `abort_d_storage_upload` removes the config row of an upload that never committed data, and the e2e reset truncates the table.
- "Latest config" is the greatest `config_version`, never `created_at`. `created_at` defaults to `NOW()`, the transaction start time, so a writer that waited on a lock can commit a later row with an earlier or equal timestamp. Every reader (`d_storage_object_is_public`, `d_storage_objects_base_view`, `notify_d_storage_objects_view`, `d_storage_object_current_config`) orders by revision. `UNIQUE (storage_object_id, config_version)` makes a duplicate revision impossible.
- The file `20260829120007_create_function_create_d_storage_object.sql` defines `prepare_d_storage_upload`; no `create_d_storage_object` function exists. `prepare_d_storage_upload` is the only function that creates a first config row, and it writes revision 1.
- Supabase default privileges grant `EXECUTE` on new functions to `PUBLIC`, `anon`, and `authenticated`. Every internal function therefore needs an explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, and entry points are granted back to `authenticated, service_role` only.
- Domain outcomes are returned as tagged `jsonb`, never raised. A `RAISE` rolls back the whole job transaction, which would also undo the `active -> expired` transition that must commit. Only programming errors (NULL arguments, unregistered operation) raise.
- Lock order is fixed: the `d_storage_objects` parent row `FOR NO KEY UPDATE` first, then the challenge row. `FOR NO KEY UPDATE` does not conflict with the `FOR KEY SHARE` an upload insert takes through its foreign key, so uploads are not blocked. Removing the parent lock makes concurrent writers collide on the unique constraint (verified by mutation).
- Authorization is an exact `d_storage_objects_roles.role = 'owner'` row. Do not use `authorize_d_storage_object(..., 'd_storage_objects.write')`: editors hold `write`.
- A challenge is bound to actor, operation kind, target type, target id, and expected revision. The proof is 32 random bytes (43 URL-safe base64 characters); only `sha256('sqldev.confirmation.proof.v1' || chr(10) || proof)` is stored. A partial unique index allows one `active` challenge per binding. A new challenge supersedes earlier active ones in the same transaction. Expiry is `now() >= expires_at` on PostgreSQL time; the browser clock never decides.
- A challenge is consent, not authorization: `d_storage_apply_make_public` re-checks the owner role and the revision at confirmation time. A failed owner or revision check leaves the challenge `active`.

## Registering another confirmable operation

1. Insert a row into `app_confirmable_operations` (`operation_kind`, `target_type`, `validity` up to 15 minutes).
2. Add an initiation entry point that locks the target parent row, checks authorization and the revision, and calls `app_confirmation_issue`.
3. Add a branch in `confirm_app_operation` that calls an operation-specific apply function. That function locks the parent row, then `app_confirmation_lock`, calls `app_confirmation_classify`, re-checks authorization and the revision, performs the mutation, then calls `app_confirmation_consume`, all in one transaction.
4. Grant only the entry points; revoke the internals.
5. Allowlist the new functions in `packages/functions/internal/sqldb/session.go`.

## Go API and worker facts (verified)

- Two routes: `POST /api/storage/buckets/{bucketName}/objects/visibility` (`visibility: public` begins make-public, `private` makes private) and the generic `POST /api/confirmations`. Both complete as a `ConfirmableOperationResult` in `JobState.result`: `confirmation_required`, `visibility_changed`, or `rejected` with a reason.
- A domain rejection is a **completed** job with HTTP 200. `Server.Finish` drops the body of any outcome with status >= 400, so a 4xx rejection would lose its reason.
- `strictJSONBody` (`router.go`) guards only those two routes. The generated handler ignores unknown JSON fields and leaves missing ones at zero. `decodeStrict` catches unknown fields at any depth but not missing ones, so executors and result decoding also call `hasExactKeys`. A missing `public` would otherwise silently mean "make private".
- `jobs.Fingerprinted` kinds store `Fingerprint(kind, body)` on the status record at creation. `submit` returns 409 `idempotency_conflict` before the queue when a key is reused with a different body. `status.Memory.Update` keeps the fingerprint like `Dynamo.Update` does.
- The status record expires after 24 hours; DBOS keeps its workflow. A reused key then yields a fresh `pending` record behind a finished workflow. `reconcileOutcome` settles it from the recorded `jobs.Outcome` (the worker stamps `Outcome.Fingerprint`) and runs nothing again; a different body becomes a completed `idempotency_conflict`.
- The proof is in the SQS body, the DBOS input/output, and the owner-scoped job result (24 h TTL, single use, 5 min validity). It is never logged and never in `Record.Message`, the fingerprint, or any status attribute.
- Adding the `Visibility` enum to `api.yaml` renamed the constants of `/notify`'s inline `visibility` enum, which broke `notify.go`. `/notify` now references the shared `Visibility` schema. Rebuild after every spec edit.
- Run `go generate` with `CGO_ENABLED=0`. Its `config.yaml` output path is relative to the working directory, so run it from `packages/functions/cmd/goapi` or it writes a stray `api/api.gen.go` elsewhere.
- Integration tests (`-tags integration`, `SQLDEV_TEST_DATABASE_URL`): `internal/sqldb` covers the SQL functions; `cmd/supabaseworker` runs the production path (API handler, status store, queue message, `processor.Accept`, real DBOS, `sqldb.Session`) with DBOS state in a throwaway `dbos_it_*` schema that the test drops.

## Testing against the database

Integration tests live in `packages/functions/internal/sqldb/*_integration_test.go` behind the `integration` build tag and need a database:

```bash
SQLDEV_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  CGO_ENABLED=0 go -C packages/functions test -tags integration -count=1 ./internal/sqldb/...
```

Apply new migrations to a running local database with `sqldev --stage dev supabase migration up --local`; use `db reset` only when you intend to wipe local data.

`commit_d_storage_upload` takes about 700 ms locally because its insert trigger calls `notify_http_post` against an unreachable URL. The harness's `createObject` inserts the data row with `session_replication_role = replica` for that one transaction (using the real `prepare_d_storage_upload`), and `createObjectViaRPC` keeps the full path covered. Without this a 100-case property takes over a minute.

## Frontend and end-to-end facts (verified)

- The generic client lives in `packages/frontend/src/utils/confirmation/`: pure `transition` in `dialogMachine.ts` is the model, `confirmationStore.ts` is a non-persisted Zustand coordinator (separate from the persisted `storageTableStore`), `finalSuccessLedger.ts` guarantees one cache invalidation per committed change, `focusRestore.ts` returns focus to the trigger. A single `ConfirmationDialogHost` is mounted in `StorageCRUDTable`; a new operation only adds an adapter (see `storage/visibility/storageMakePublicAdapter.ts`).
- Do not use the shared `AlertDialog` for the host: its action button chains `close`, so the dialog would close while the confirmation job runs. The host composes `Dialog`, `Heading`, `Button`; Cancel gets `autoFocus`; `aria-busy` is set through the Dialog `render` prop; buttons that can hold focus use `isPending`.
- Zustand v5 selectors must return stable values; select functions one by one.
- Row keys are S3 keys: compare the `data-key` attribute instead of building a selector.
- A `MenuItem` whose `id` changes with data must be remounted with `key={id}`, otherwise React Aria throws "Cannot change the id of an item" when a refetch flips Make public to Make private while the menu is open (found by `driveVisibility.cy.ts`).
- The e2e/staging reset SQL truncates without CASCADE: a new table referencing `users` must be added to `packages/cli/internal/e2ereset/application_reset.sql` and `plan_test.go`.
- `bun run build` clobbers the Vite optimizer cache under a running `astro dev` (504 "Outdated Optimize Dep", Clerk never loads). Touch `packages/frontend/astro.config.mjs` to restart dev.
- Cypress: `packages/e2et/cypress/e2e/driveVisibility.cy.ts` with `support/driveObjects.ts`; selectors are `data-cy` `dStorage_make_public`, `dStorage_make_private`, `confirm_dialog`, `confirm_dialog_confirm`, `confirm_dialog_cancel`, `confirm_dialog_refresh`, `confirm_dialog_status`.
- Validation: `bun run packages/frontend/scripts/verify-visibility.ts` (see `AGENTS.md`).
