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
