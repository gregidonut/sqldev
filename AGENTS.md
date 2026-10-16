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
deployed host, so a fresh or replaced staging host needs
`sqldev --stage staging host vault sync` (see `packages/cli/internal/e2ereset/vault.go`).
Without them posts save with no rendered HTML and no MQTT notify is sent, and the
specs that wait on rendered headings or live updates fail. The command is exact-
staging only, derives the values from the linked `GoApi.url` and `NotifySecret`,
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
`packages/agent-skills/skills/confirmable-operations/SKILL.md` skill; the spec is
`.kiro/specs/storage-visibility-confirmation/`.

Verified facts the protocol depends on:

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
  `public` would become `false`). Use `hasExactKeys` for payloads and results.
- Adding an enum to `api.yaml` can rename the constants of other inline enums that share
  a value name (adding `Visibility` renamed `/notify`'s `public`/`private` constants).
  Regenerate and build after every spec edit. Run `go generate` from
  `packages/functions/cmd/goapi` with `CGO_ENABLED=0`, and never hand-edit `api.gen.go`.

Verification: Go unit tests run with `CGO_ENABLED=0 go -C packages/functions test ./...`.
Database and worker integration tests need local Supabase and the `integration` tag:

```bash
SQLDEV_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  CGO_ENABLED=0 go -C packages/functions test -tags integration -count=1 -p 1 \
  ./internal/sqldb/ ./cmd/supabaseworker/
```

Apply new migrations to a running local database with
`sqldev --stage dev supabase migration up --local` (use `db reset` only to wipe data).

Frontend and harness facts (verified):

- Layout: the generic protocol lives in `packages/frontend/src/utils/confirmation/`
  (`dialogMachine.ts` pure `transition`, `confirmationStore.ts` non-persisted Zustand
  coordinator, `decodeResult.ts`, `finalSuccessLedger.ts`, `focusRestore.ts`). One
  `ConfirmationDialogHost` is mounted once in `StorageCRUDTable`; the storage adapter and
  menu wiring are under `RACCRUDTable/storage/visibility/`. `AlertDialog.tsx` is not used
  because its action button closes the dialog while confirming.
- Zustand v5 selectors must return stable values; select each function separately instead
  of returning a fresh object literal.
- React Aria `Dialog` does not forward `aria-busy`; set it through the `render` prop. Use
  `isPending` (not `isDisabled`) on buttons that may hold focus.
- Row keys are S3 keys, so `focusRestore` compares the `data-key` attribute directly
  instead of building a CSS selector.
- React Aria collection nodes cannot change `id`. A `MenuItem` whose id flips with data
  (`make-public` <-> `make-private`) needs `key={id}` or React throws "Cannot change the
  id of an item" when a refetch lands while the menu is open.
- The e2e/staging reset SQL (`packages/cli/internal/e2ereset/application_reset.sql`)
  TRUNCATEs without CASCADE, so every new table that references `users` must be listed
  there (27 tables now) and `plan_test.go` updated. `app_confirmable_operations` is seeded
  config and is intentionally not listed.
- The Cypress suite start-up truncates local app data (users, posts, storage objects).
- `bun run build` (`astro build`) rewrites `packages/frontend/node_modules/.vite`, which a
  running `astro dev` shares. Afterwards the browser gets `504 (Outdated Optimize Dep)` for
  `@clerk_astro_internal.js`, Clerk never loads, and pages (and Cypress sign-in) break.
  Touching `packages/frontend/astro.config.mjs` restarts the dev server and fixes it.
- Never run Prettier over existing directories (it reformatted
  `thumbnailRailStore.ts`); format only new files.
- `bun run packages/frontend/scripts/verify-visibility.ts` runs every validation command
  and checks that Properties 1-15 all executed (`--with-db-reset` adds the destructive
  `supabase db reset`; logs go to `/tmp/verify-visibility/`).

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
