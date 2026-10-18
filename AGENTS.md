<!-- intent-skills:start -->
## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:
- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## Required project context

Before every repository task, read and follow `packages/agent-skills/skills/understanding-sqldev/SKILL.md`.

## Stage-aware Cypress harness

`sqldev --stage <stage> cypress ...` selects the Cypress target, Clerk/Supabase
resources, and the two test users from the linked SST stage. There is no
`cypress.env.json`; test users come from the `CyTestUsersJson` secret (exactly two ordered, distinct `{ "user_id": string }`
entries, accepted either as a bare array or the legacy
`{ "test_users": [...] }` wrapper) and the Go CLI
injects them process-only into the Cypress config, which validates them once and
never logs identifiers. Target selection: `dev` is fixed at
`http://localhost:4321`; `staging` uses the linked `Frontend.url`, cross-checked
against `AstroAppDomain` (both must normalize to the same origin). Every root
visit asserts the expected origin.

Resolution and transport live in `packages/cli/internal/e2econfig` (wired into
`passthrough.RunCypress`); parsing/merge live in
`packages/e2et/cypress/config/{runtime,harnessEnv}.ts`; the thin
`packages/e2et/cypress.config.ts` sets `baseUrl` and merges `clerkSetup` output.

Staging is disposable. Before a `staging` run the suite performs a destructive
reset through `sqldev --stage staging e2e reset`: it truncates only the audited
application tables (the single shared SQL asset
`packages/cli/internal/e2ereset/application_reset.sql`, also used by the local
reset) over SSM on the staging host, and empties only `SQLDevBucket`. It
preserves Clerk users, DBOS history, queues/DLQ, job status, and
`JobResultBucket`. The reset is fail-closed: it runs only when the configured
stage and linked `App.stage` are both exactly `staging`, the frontend/domain
origins agree, exactly one tagged staging host resolves, and the application and
job-result buckets differ. Database credentials never leave the host; use
`--preflight` to validate identities without mutating. `E2E_FULL_DB_RESET=1` and
the whole-bucket `emptyBucket` task remain local-only. Staging runs must be
serialized across machines/CI; the run lock is process-local only.
The reset SQL is embedded in the `sqldev` binary at build time (`packages/cli/internal/e2ereset`),
so an installed binary built before a table was added to `application_reset.sql` truncates the
old list and fails on staging with `cannot truncate a table referenced in a foreign key
constraint` (the CLI hides the remote error; read it with `aws ssm list-command-invocations
--details`). Rebuild and reinstall the CLI after changing that file.

Staging network and Clerk facts the harness depends on (verified): a live Clerk
instance (`sk_live_`) rejects the Backend API `sessions.createSession`
(`request_invalid_for_environment`), so `packages/e2et/cypress/tasks/clerk.ts`
creates actor sessions by exchanging a sign-in token through the Frontend API
(`clerkFapi.ts`); dev keeps `createSession`. Staging's `SupabaseUrl` is a private
VPC address and the `GoApi` API Gateway resource policy
(`infra/api.ts`) denies every caller except the NAT egress IP, so a developer
machine can reach neither. Cypress seed tasks (`createIgPostAsUser`,
`createTdsTodoSpaceAsUser`/`createTdsTodosAsUser`) therefore use the deployed
frontend's same-origin `/api/*` proxy with the actor's native session token
(`apiSeed.ts`, `goApiJobs.ts`) on non-local stages, and the direct Supabase RPC
path on local stages. CloudFront caches 404s from `/api/**` by path regardless
of credentials, so a 404 observed right after an authenticated request to the
same path can be a cached response, not a fresh one.

The database triggers read three Vault secrets (`render_md_url`,
`notify_ig_posts_view_url`, `notify_ig_posts_view_secret`). Locally they come
from `packages/backend/supabase/config.toml` `[db.vault]`. Nothing in
`packages/backend/selfhost/bootstrap.sh` or `infra/` creates them on the
deployed host. `sqldev host replace` keeps the data volume, so the secrets
survive it. A fresh volume starts empty; `sqldev --stage staging host data-volume replace`
restores them after bootstrap, and `sqldev --stage staging host vault sync`
(see `packages/cli/internal/e2ereset/vault.go`) provisions them when they are
missing.
Without them posts save with no rendered HTML and no MQTT notify is sent, and the
specs that wait on rendered headings or live updates fail. `host vault sync` is
exact-staging only, derives the values from the linked `GoApi.url` and `NotifySecret`,
upserts by name in one transaction, and prints names only; `--preflight` lists
which names exist. SSM keeps command parameters in its history, so the notify
secret is readable by principals that can read SSM commands in the account.

Before changing the harness, the resolver, the reset command, or the Go
`e2e reset` handler, load `understanding-sqldev` and (when authoring tests)
`cypress-author`. The referenced `golang-*` skills remain uninstalled; follow
existing `packages/cli` Go patterns and do not download replacements.

## Confirmable operations (storage object visibility)

A drive storage object can be made public from the three-dot menu on `/drive/mine`
(`Make public…` / `Make private`). Making it public uses a reusable "confirm before
commit" protocol whose authority is PostgreSQL. Before changing it, load the
`packages/agent-skills/skills/confirmable-operations/SKILL.md` skill. Specs:
`.kiro/specs/storage-visibility-confirmation/` (protocol) and
`.kiro/specs/confirmation-dialog-copy/` (registry identity and dialog copy).

Protocol facts:

- The single-concurrency DBOS worker must never wait for a human. Make-public is two
  independent jobs: an initiation job that issues a five-minute challenge and
  *completes* with `confirmation_required`, then a separate confirmation job that
  consumes the challenge and appends the config row in one transaction. Never add an
  `awaiting_confirmation` job status.
- `d_storage_object_config` is insert-only (an update trigger rejects `UPDATE`). The
  current row is the greatest `config_version`, never the latest `created_at`
  (`created_at` is the transaction start time). `prepare_d_storage_upload` is the only
  writer of a first config row, and it writes revision 1; the file named
  `20260829120007_create_function_create_d_storage_object.sql` defines it.
- Domain rejections are returned as tagged `jsonb` and become *completed* jobs with
  HTTP 200, because `Server.Finish` drops the body of any outcome with status >= 400
  and a `RAISE` would roll back the `active -> expired` transition.
- Supabase default privileges grant `EXECUTE` on new functions to `anon` and
  `authenticated`. Revoke explicitly on every internal function.
- Editors hold `d_storage_objects.write`. Visibility needs an exact `role = 'owner'` row.
- An Idempotency-Key is bound to its request body by a fingerprint stored on the job
  status record (`jobs.Fingerprinted` kinds only). A conflicting reuse is a 409 before
  the queue. The status record expires after 24 hours but DBOS keeps the workflow, so
  `reconcileOutcome` in `packages/functions/cmd/supabaseworker/main.go` settles a
  recreated record from the recorded outcome without running anything again.
- `decodeStrict` rejects unknown JSON fields but cannot see a missing one (a missing
  `public` would become `false`). Use `hasExactKeys` for payloads and results, and for
  every nested object of a result (`target` and `dialogCopy` in
  `decodeOperationResult`, `packages/functions/cmd/goapi/api/visibility.go`).
- Adding an enum to `api.yaml` can rename the constants of other inline enums that share
  a value name (adding `Visibility` renamed `/notify`'s `public`/`private` constants).
  Plain string and object schemas (`RegistryIdentifier`, `AuthoritativeDialogCopy`) renamed
  nothing. Regenerate and build after every spec edit. Run `go generate` from
  `packages/functions/cmd/goapi` with `CGO_ENABLED=0`, and never hand-edit the generated Go file.

Registry identity and dialog copy (defined in
`packages/backend/supabase/migrations/20261101090100_create_app_confirmation_protocol.sql`
and `packages/backend/supabase/migrations/20261101090200_create_d_storage_visibility_functions.sql`;
there is no separate registry migration, and a regression test keeps it that way):

- Registry identity: `app_confirmable_operations.registry_id` is a `BIGINT` taken from the
  owned `NO CYCLE` sequence `app_confirmable_operations_registry_id_seq`, which starts at
  1000. It is unique, at least 1000, and immutable (a trigger rejects an `UPDATE` of it).
  It is presentation and protocol identity only and never an authorization input. A failed
  or rolled-back insert still consumes a value, so identifiers are increasing, not gapless;
  at the maximum the next insert fails and no row changes.
- Challenge binding: `operation_kind` stays the registry primary key and the foreign key of
  `app_confirmation_challenges`. A challenge is bound to `operation_kind`, never to
  `registry_id`.
- Copy ownership: the copy lives in the registry columns `dialog_title_template`,
  `dialog_description` and `dialog_confirm_label`. Their `CHECK`s require non-blank text
  (Unicode `White_Space`, `app_confirmation_text_is_blank`), exactly one `{{targetLabel}}`
  in the title, and at most 2000 and 80 code points. `begin_d_storage_make_public` resolves
  the copy: after the guard it reads the newest `d_storage_object_data.file_name`, calls
  `app_confirmation_issue`, and passes the registry row's copy and the label to
  `app_confirmation_resolve_dialog_copy`, which replaces the token literally in one pass,
  never trims or truncates, and raises on blank text or a title over 200 code points. The
  result then carries `registryId` and `dialogCopy`. A `RAISE` after issuance rolls back the
  new challenge and any supersession, so keep the label read and the resolver after the guard.
- `app_confirmation_issue` returns the challenge plus `registry_id` and the three copy
  columns from the registry row it reads `FOR SHARE`. It, the resolver, the blank helper,
  the registry table with its sequence and `registry_id` immutability trigger live in
  `20261101090100`; `begin_d_storage_make_public` lives in `20261101090200`. Each object is
  declared once, in the migration that defines it: when you change one, edit that file (and
  `supabase db reset --local`) instead of adding a file that alters it.
  `packages/functions/internal/sqldb/migration_history_test.go` (no database needed) fails
  on a second declaration, a `CREATE OR REPLACE`/`ALTER`/`DROP` of these objects in another
  file, a `setval` in the seed, or a separate `*registry_id*` migration.
- The two files were edited in place to carry the registry identity and copy, so a database
  that applied the earlier versions keeps the old shape and must be rebuilt: local dev with
  `sqldev --stage dev supabase db reset --local`, a deployed database by rebuilding its
  data volume with `sqldev --stage staging host data-volume replace`. Replacing only the
  EC2 instance keeps that volume, and the worker records applied versions in
  `supabase_migrations.schema_migrations`, so it will not re-run an edited file. The seed insert omits `registry_id`, so the first value comes from
  the sequence start (1000). Compare function argument types through `proargtypes::TEXT`
  when you write a catalog check (an `oidvector` is zero-based, so `= ARRAY[...]` is silently
  false).
- Wire form: `RegistryIdentifier` in `packages/functions/cmd/goapi/api.yaml` is a string of
  canonical decimal text (not a JSON number, so JavaScript keeps every value).
  `AuthoritativeDialogCopy` (`title` 1-200, `description` 1-2000, `confirmLabel` 1-80,
  no extra keys) and `ConfirmationRequiredResult` (nine required keys) are in the same file.
- Go validation: `decodeOperationResult` enforces the contract because generated code
  does not check patterns or lengths and a missing key decodes to a zero value. It uses
  `hasExactKeys` over the nine keys and over `target` and `dialogCopy`, `validRegistryID`
  (`ParseInt` + `>= 1000` + `FormatInt` equality), and `validCopy` (Unicode `White_Space`
  spelled out in `isBlankRune`, not `strings.TrimSpace`; code-point bounds 200/2000/80). A
  failure becomes the generic `outcomeError`, which omits the payload (it holds the proof).
- Shared corpus: `packages/functions/cmd/goapi/api/testdata/confirmable_results.json` has
  `valid` (nine-key results), `legacy` (fully valid seven-key results: Go rejects them,
  TypeScript classifies them as a legacy copy error) and `malformed` (both reject).
  `valid` and `legacy` hold bare results, `malformed` holds `{name, value}` pairs.
  Non-ASCII characters are `\uXXXX` escapes; never put a lone surrogate in it (Go's `json`
  turns it into U+FFFD and accepts it, so the bindings would disagree).
- Replay carries the nine-key body unchanged: `operationOutcome` re-marshals the validated
  struct (semantically equal to the database result, not byte-equal: `<`, `>`, `&` become
  `\uXXXX` escapes), the body stays inline on the status record under `resultInlineLimit`
  (`api/submit.go`), request fingerprints cover only the request payload, and
  `reconcileOutcome` returns the recorded outcome as is. Editing the registry copy changes
  only later initiations.
- The e2e/staging reset SQL (`packages/cli/internal/e2ereset/application_reset.sql`)
  TRUNCATEs without CASCADE, so every new table that references `users` must be listed
  there (27 tables) and `plan_test.go` updated. `app_confirmation_challenges` is listed;
  `app_confirmable_operations` is seeded config and is not. The reset has no
  `RESTART IDENTITY` (`e2ereset/sql.go` forbids it, `CASCADE`, `DROP` and `DELETE FROM`), so
  neither the registry rows nor `app_confirmable_operations_registry_id_seq` are reset.

Go and database tests:

- Registry tests (`packages/functions/internal/sqldb/confirmable_registry_*`,
  `confirmation_dialog_copy_*`; helpers in `confirmation_dialog_copy_helpers_integration_test.go`)
  must not advance the real sequence. Run each registry write in an always-rolled-back
  transaction (`scratchTx`); `useScratchRegistrySequence` swaps the column `DEFAULT` to a
  `TEMP SEQUENCE` with the real options. The default is evaluated before the `CHECK`s and the
  primary key, so a failed insert consumes a value, while an explicit `registry_id` that fails
  a check consumes none. To fake an invalid registry row, drop the relevant `CHECK` in that
  transaction and use `SET LOCAL session_replication_role = replica` (skips the immutability
  and foreign-key triggers), then set `origin` again before calling the function (`callInTx`).
  Tag a property test `Feature: confirmation-dialog-copy, Property N: <title>` on the leaf test
  (`copyProperty`).
- `TestInternalConfirmationFunctionsAreNotCallable` (`internal/sqldb/session_test.go`) is a
  unit test that lists the internal functions, including the resolver and the blank helper.
- The worker replay test is
  `packages/functions/cmd/supabaseworker/dialog_copy_replay_integration_test.go` (Property 2,
  replay half) on the `visibility_rig_integration_test.go` rig. The rig's owners need a
  `d_storage_object_data` row (`newOwnerNamed`) because initiation reads the file name. The job
  id is per idempotency key, so a conflicting body sent after the record expired overwrites that
  key's status record with `idempotency_conflict`; do that check last. `workflowState` must wait
  for a finished DBOS state because the job record completes inside the workflow body.
- Go unit tests: `CGO_ENABLED=0 go -C packages/functions test ./...`. Database and worker
  integration tests need local Supabase (its database port is `[db] port` in
  `packages/backend/supabase/config.toml`) and the `integration` tag:

```bash
SQLDEV_TEST_DATABASE_URL="<local Supabase database URL>" \
  CGO_ENABLED=0 go -C packages/functions test -tags integration -count=1 -p 1 \
  ./internal/sqldb/ ./cmd/supabaseworker/
```

  Apply new migrations to a running local database with
  `sqldev --stage dev supabase migration up --local` (use `db reset` only to wipe data).

Frontend and harness facts:

- Layout: the generic protocol lives in `packages/frontend/src/utils/confirmation/`
  (`dialogMachine.ts` pure `transition`, `confirmationStore.ts` non-persisted Zustand
  coordinator, `decodeResult.ts`, `finalSuccessLedger.ts`, `focusRestore.ts`). One
  `ConfirmationDialogHost` (`RACCRUDTable/confirmation/ConfirmationDialogHost.tsx`) is
  mounted in `StorageCRUDTable`. The adapter role is transport and final-success invalidation
  only: `RACCRUDTable/storage/visibility/storageMakePublicAdapter.ts` holds no title,
  description or button label, and the dialog text comes from the validated result
  (`ConfirmationRequired.dialogCopy`). `AlertDialog.tsx` is not used because its action
  button closes the dialog while confirming.
- Types (`utils/confirmation/protocol.ts`): `registryId` is a branded decimal string
  (`RegistryIdentifier`). `DialogSubject` has no `label` and `ConfirmableOperationAdapter` is
  only `kind`, `initiate`, `confirm`, `onFinalSuccess`. `ProtocolError` is tagged by `scope`
  (`payload`, or `copy` with `shape: "legacy" | "malformed"`); every literal must name its
  scope. `rejected` is a `mode` union: `domain-or-request` (with `cause`) or
  `safe-copy-fallback` (with `error`). `expired` and `refreshing` carry the last validated
  `copy` but not the challenge.
- Safe fallback: a `confirmation_required` result that is not a valid nine-key result puts the
  dialog in `safe-copy-fallback` (`dialogMachine.ts`). This includes results recorded before this
  feature existed, which have seven keys and decode as `shape: "legacy"`. Only `Close` and
  `Get new confirmation` are offered; `FRESH_INITIATION` is accepted only from the fallback and
  starts a new initiation with a new idempotency key. A copy-scoped error returned for a
  confirmation (not an initiation or refresh) is a `domain-or-request` `protocol_error`, never
  the fallback.
- Decoder (`utils/confirmation/decodeResult.ts`): nine valid keys is a result; exactly the
  seven pre-feature keys with valid values is `{scope: "copy", shape: "legacy"}`; anything else
  of that kind is `shape: "malformed"`; any other kind or a non-object is `scope: "payload"`.
  The registry id is checked with `BigInt("1000")`/`BigInt("9223372036854775807")` calls (not
  `1000n` literals), copy lengths with `Array.from(value).length`, blankness with the explicit
  Unicode `White_Space` class (not `trim()`, which also strips U+FEFF), and a lone surrogate is
  rejected (`JSON.parse` can produce one from a `\ud800` escape even though the corpus cannot).
- Presentation (`dialogMachine.ts`): `presentationFor(state)` returns the validated copy for
  `confirmation-ready`, `confirming`, `expired` and `refreshing` and fixed generic strings that
  name no operation otherwise. In `requesting` the confirm button is hidden because no
  authoritative label exists yet. `registryIdFor(state)` returns the `registryId` of the validated
  result being shown (`expired` and `refreshing` carry it beside `copy`) and null otherwise; the
  host prints it as `Operation ID: <id>` outside the described description,
  `cy("confirm_dialog_registry_id")`. It is display only and is never sent back.
- Host: renders only `presentationFor(view)` as React text children (no
  `dangerouslySetInnerHTML`). The heading is the one accessible name; `<p id>` and
  `aria-describedby` exist only when the description is non-null. The primary button needs
  `controlsFor(...).confirm.visible` and a non-null `confirmLabel`. The fallback's Cancel button
  reads `Close` and has `autoFocus`; `Get new confirmation` is
  `cy("confirm_dialog_fresh_initiation")`. `cy()` emits `data-cy` only when `PUBLIC_APP_STAGE`
  is `dev`/`staging`, so `bun test` cannot select by it; tests assert the source uses the helper.
- Frontend tests: `utils/confirmation/dialogCopy.property.test.tsx` is the one test named
  `Feature: confirmation-dialog-copy, Property 4` (keep it a single `test`, or the runner counts
  Property 4 twice). `ConfirmationDialogHost.test.tsx` has the static scan for make-public
  literals over the host and the non-test `utils/confirmation/*.ts` files.
  `decodeResult.property.test.ts` reads all three corpus sections (`valid` round trips,
  `legacy` decodes to `shape: "legacy"`, `malformed` decodes to a `protocol_error`).
  `utils/confirmation/guidanceSources.test.ts` checks these guidance files against the sources.
- Zustand v5 selectors must return stable values; select each function separately instead
  of returning a fresh object literal.
- React Aria `Dialog` does not forward `aria-busy`; set it through the `render` prop. Use
  `isPending` (not `isDisabled`) on buttons that may hold focus.
- Row keys are S3 keys, so `focusRestore` compares the `data-key` attribute directly
  instead of building a CSS selector.
- React Aria collection nodes cannot change `id`. A `MenuItem` whose id flips with data
  (`make-public` <-> `make-private`) needs `key={id}` or React throws "Cannot change the
  id of an item" when a refetch lands while the menu is open.
- `bun run build` (`astro build`) rewrites `packages/frontend/node_modules/.vite`, which a
  running `astro dev` shares. Afterwards the browser gets `504 (Outdated Optimize Dep)` for
  `@clerk_astro_internal.js`, Clerk never loads, and pages (and Cypress sign-in) break.
  Touching `packages/frontend/astro.config.mjs` restarts the dev server and fixes it.
- Never run Prettier over existing directories (it reformatted
  `thumbnailRailStore.ts`); format only new files.
- The Cypress suite start-up truncates local app data (users, posts, storage objects).
  `packages/e2et/cypress/e2e/driveVisibility.cy.ts` asserts the dialog against the job result's
  `dialogCopy`; covers a markup-like committed file name (literal title, no created elements, no
  handler run), a legacy seven-key result that must show only `Close` and `Get new confirmation`,
  and an expiry refresh whose second result carries different copy. It simulates the legacy
  result by editing the parsed `GET /api/jobs/:id` body in place (assigning a new `res.body`
  object is not delivered to the page). Its `badgeFor` waits up to 20 s because a visibility
  change is a queued job plus a list refetch.

Validation runners (run from the workspace root):

- `bun run packages/frontend/scripts/verify-visibility.ts` runs the baseline validation
  commands and checks that Properties 1-15 all executed (`--with-db-reset` adds the
  destructive `supabase db reset`; logs go to `/tmp/verify-visibility/`).
- `bun run packages/frontend/scripts/verify-confirmation-dialog-copy.ts` is the sibling runner
  for the dialog-copy feature (`confirmation-dialog-copy` Properties 1-5; logs go to
  `/tmp/verify-confirmation-dialog-copy/`; it never resets a database). Flags: `--only a,b` and
  `--skip a,b` select commands by name, `--with-build` adds `astro-build` and `--with-cypress`
  adds `cypress-visibility`. Both opt-in commands are skipped by default because the build
  rewrites `node_modules/.vite` and Cypress truncates local application data. A skipped command
  makes the verdict `incomplete` (exit 2), never `pass`; exit 0 is pass and 1 is fail.
  `migration-apply` and Cypress need `AWS_PROFILE`/`AWS_REGION` (the runner defaults them to the
  documented dev values). The decision is the pure module `scripts/verifyCopyAccounting.ts`
  (`REQUIRED_TESTS`, `account`, `parseGoJson`, `parseBunVerbose`): Go tags come from
  `go test -json` (only the leaf test path counts), TypeScript tags from `bun test` `(pass)`
  lines. Required distinct tagged tests: Property 1 Go x1, Property 2 Go x2 (database half and
  worker replay half), Property 3 Go x1 and TypeScript x1, Properties 4 and 5 TypeScript x1;
  extra distinct tests are "duplicate", a test seen by two commands counts once, and a failure
  wins. The typecheck tolerates only the baseline files in `TSC_BASELINE_FILES`.

## Loading bar / thumbnail rail state

The "loading bar" is the thumbnail progress rail (`ThumbnailProgressRail` + `railView` in `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/StorageThumbnail.tsx`). Its lifecycle state lives in a per-`sourceKey` Zustand store at `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/store/thumbnailRailStore.ts` (no longer local React state). See `packages/frontend/AGENTS.md` for details.

## MDX editor

The reusable Markdown editor lives at
`packages/frontend/src/components/react/MdxEditor/`. It is a controlled
Visual/Vim editor (`MdxEditor.tsx`), an RHF field adapter (`MdxEditorField.tsx`),
a valid-state sizing union plus pure helpers (`types.ts`), scoped authoring CSS
(`mdxEditor.css`), lazy per-mode adapters under `editors/`, and the pure
TanStack Query option factories under `queryOptions/` (render client plus
Instagram create/fetch-one/update). The authenticated demo at
`/components/mdxEditor` is its first consumer; `/instagreg/home` post creation
(`PostArea/FormSection`) and the DDrvList edit form (`ItemEditForm`) reuse it.
Before changing that component, its demo, its render path, or the Go
`/renderMd` handler, load the
`packages/agent-skills/skills/mdx-editor-demo/SKILL.md` skill and see
`packages/frontend/AGENTS.md` for details.

Cypress specs for the editor must use the helpers in
`packages/e2et/cypress/support/mdxEditor.ts` (`visualEditable`,
`replaceVisualText`, `runExCommand`), not ad-hoc selectors. MDXEditor 4.3.2
applies `contentEditableClassName` to both the real contenteditable and the
empty-state placeholder, so target
`.mdx-visual-editor__content[contenteditable='true']`. Click the fixed-height
demo editor with `.click("top")`; replace text with one
`type("{selectall}<text>")`; send Vim `:w`/`:wq` through `runExCommand`. Run one
spec with `sqldev --stage dev cypress run --headless --browser chrome --spec cypress/e2e/<file>.cy.ts`
(path relative to `packages/e2et`). `drive.cy.ts`'s first-file upload test can
flake in `sst dev` when `GET /api/jobs/:id` returns 500 from the live-Lambda
bridge (`pollJob` in `src/server/requestJob.ts` does not retry non-2xx); it is
unrelated to the editor and is not a product bug. Details are in the
`mdx-editor-demo` skill.
