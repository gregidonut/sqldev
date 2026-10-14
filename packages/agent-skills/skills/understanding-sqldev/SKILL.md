---
name: understanding-sqldev
description: >
  Loads mandatory SQLDev project context before any repository task: SST
  infrastructure, the packages/cli developer CLI, Supabase schema and RBAC, the Go
  API, the Astro frontend, and Cypress. Use for every SQLDev task, including
  questions, reviews, and edits. Update the maintained project knowledge
  reference when a durable fact is verified from repository source.
---

# Understanding SQLDev

Read this skill before investigating or changing the repository. Then read [references/project-knowledge.md](references/project-knowledge.md). Trust current source over either document. When this task allows edits and a durable fact is verified, update the knowledge reference using the rules below.

## Maintained knowledge

Update `references/project-knowledge.md` only when all of these are true:

- The current task allows repository edits. Read-only, plan, and ask tasks never write it.
- The fact was verified from authored source in this task. Cite the repo-relative path.
- The fact will still help a future task. Replace or delete a stale entry; do not append a diary.

Never record secrets, environment values, tokens, personal data, production data, terminal output, guesses, or unresolved hypotheses. Exclude transient state: branch, running services, deployment status, recent failures, and uncommitted changes. Link to source instead of copying schemas, API contracts, scripts, or dependency versions. Do not cite a generated file when an authored source exists. If sources conflict, follow the current source and leave the conflict out until it is resolved.

## Where work belongs

| Area | Source of truth | Do not hand-edit |
| --- | --- | --- |
| Infrastructure | `sst.config.ts`, `infra/*.ts` | `sst-env.d.ts` |
| Linked dev commands | `packages/cli` (the `sqldev` Go CLI) | — |
| Database | `packages/backend/supabase/migrations`, `packages/backend/supabase/config.toml` | generated Supabase types |
| Go HTTP contract | `packages/functions/cmd/goapi/api.yaml`, `config.yaml` | `packages/functions/cmd/goapi/api/api.gen.go` |
| Frontend | `packages/frontend` | — |
| Browser tests | `packages/e2et/cypress` | — |

The frontend adapter is the published package `@sst-community/astro-sst`, declared in `packages/frontend/package.json`. Its Lambda entry uses Astro's automatic server entrypoint, so deployed requests run `packages/frontend/src/fetch.ts` before page matching.

## SST and commands

SST is the TypeScript infrastructure for this AWS application in `ap-east-1`. Keep long-lived configuration in `infra/secrets.ts`. A process environment variable is acceptable for a quick local test; move that value into an SST secret when it should remain.

Commands that need linked resources run through the `sqldev` Go CLI in `packages/cli`. It discovers the repository root, loads linked SST resources from the environment, and automatically re-executes itself through `sst shell` when they are absent, so no manual `bun run shell` wrapper is needed:

```bash
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' sqldev --stage dev cypress run --headless --browser chrome
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' sqldev --stage dev cypress open
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' sqldev --stage dev supabase db reset
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' sqldev --stage dev supabase stop
```

Build the CLI with `CGO_ENABLED=0 go -C packages/cli build -o <dest> .` (the local gcc cannot link cgo). The `supabase` and `cypress` subcommands are transparent: every argument after the command name is forwarded to the vendor CLI unchanged, and linked resource values are injected. `sqldev storage empty` and `sqldev storage delete` operate on the linked bucket; run them only when the task explicitly requests that deletion. `sqldev host database tunnel` and `sqldev host replace` operate on the deployed host.

For day-to-day local development, `sqldev --stage dev dev restart` runs `sst dev`, the worker, and Imagor in separate inspectable panes of one managed tmux session (`sqldev-<stage>`), and `sqldev --stage dev dev status` reports per-pane state. `sqldev --stage dev dev restart --reset-data` empties the linked S3 bucket and runs `supabase db reset --local --no-seed` before restarting; it and `dev reset-data` are refused outside the `dev`, `local`, and `development` stages. See `.kiro/specs/local-dev-tmux-orchestration/design.md`.

## Supabase

Local Supabase is the CLI project at `packages/backend/supabase`. Start and stop it through `sqldev supabase`. The `user-postgres-dev` MCP is the local dev database; use it to inspect that database. Schema changes still belong in migrations.

Deployed Supabase is self-hosted and reached by the non-dev frontend and Go API Lambdas through the VPC in `infra/vpc.ts`. The `dev` stage does not create that VPC. The Supabase EC2 host is not declared in `infra/`.

Authorization is application RBAC plus RLS. Clerk's JWT `sub` maps to the internal user through `get_owner()`. Roles and permissions are tables and enums, not PostgreSQL role grants. Follow the `supabase` and `supabase-postgres-best-practices` skills before changing schema, policies, views, functions, or storage.

Edit a table, function, or policy in the migration that defines it while that history is still local and can be rebuilt with `db reset`. Do not add another file that revises a definition which exists only in unapplied local history. Once a migration has been applied to a shared or deployed database, do not rewrite it; add a new migration.

## Go API

The frontend-facing Go service is API Gateway REST v1, `sst.aws.ApiGatewayV1` in `infra/api.ts`. `packages/functions/cmd/goapi/main.go` adapts `APIGatewayProxyRequest` through `aws-lambda-go-api-proxy` and base64-encodes binary responses. Do not replace it with HTTP API v2 unless the task asks for that migration.

`api.yaml` is the contract. `config.yaml` configures oapi-codegen. Implementations live beside the generated file. Regenerate with `go generate` in `packages/functions/cmd/goapi` (`oapi-codegen` v2.7.0). Do not edit `api.gen.go`.

Before changing Go code, follow `golang-how-to` together with `golang-design-patterns`, `golang-documentation`, and `golang-error-handling`.

## Frontend

The app is Astro SSR with React islands, deployed by `infra/web.ts`. Authentication is `@clerk/astro`; follow `clerk-astro-patterns`. Do not apply `clerk-tanstack-patterns` — this is not a TanStack Start app.

Use TanStack Query for server state and axios for those HTTP calls. Keep database rows in the shape returned by the query, and leave sorting in SQL. Use Zustand, not component `useState` chains, when client-side logic is actually needed. Clerk and MQTT configuration already use Nanostores.

Build UI with `react-aria-components`, Tailwind 4, and the Dracula tokens in `packages/frontend/src/styles/global.css`. Follow `react-aria` for component APIs. Use the Astro docs MCP and React Aria MCP before guessing framework behavior. After React changes, follow `react-doctor`. Use `improve-react` only for a read-only audit.

Browser uploads use Uppy with `@uppy/aws-s3` and server-issued presigned URLs. Live updates use MQTT over SST Realtime (`sst.aws.Realtime`, AWS IoT), not Supabase Realtime. Postgres calls `notify_http_post` toward the Go API. Supabase Realtime is disabled in `config.toml`.

`@tanstack/ai` is installed. Before writing to its APIs, follow `tanstack-ai` and load the installed package skill. Do not call it from memory.

## Cypress

Tests live in `packages/e2et/cypress` and run through `sqldev cypress`. The harness is stage-aware: `sqldev --stage <stage> cypress ...` selects the target and the two Clerk test users from linked SST resources, so switching between local and deployed staging is only a `--stage` change. There is no `cypress.env.json`; the two ordered, distinct `{ "user_id": string }` test users come from the `CyTestUsersJson` SST secret. The Go CLI (`packages/cli/internal/e2econfig`, wired into `passthrough.RunCypress`) resolves the target origin and injects the raw secret process-only; `packages/e2et/cypress/config/{runtime,harnessEnv}.ts` validate it once, never logging identifiers, and the thin `packages/e2et/cypress.config.ts` sets `baseUrl` and preserves `clerkSetup` output. `dev` is fixed at `http://localhost:4321`; `staging` uses linked `Frontend.url` cross-checked against `AstroAppDomain`. Every root visit asserts the expected origin via `assertExpectedOrigin`.

Local database cleanup refuses any stage other than `dev`, `local`, or `development` and still verifies loopback host, API/status origin agreement, direct Postgres port, and transaction-pooler refusal. Staging is disposable and gets a destructive pre-run reset through the exact-staging-only `sqldev e2e reset` (`packages/cli/internal/e2ereset`): it truncates the audited application tables (the single shared SQL asset `application_reset.sql`, also read by the local reset) over SSM on the staging host and empties only `SQLDevBucket`, preserving Clerk users, DBOS history, queues/DLQ, job status, and `JobResultBucket`. It is fail-closed on exact stage, frontend/domain agreement, unique tagged host, and distinct app/job-result buckets; database credentials never leave the host; `--preflight` validates without mutating. `E2E_FULL_DB_RESET` and the whole-bucket `emptyBucket` task stay local-only, and staging runs must be serialized across machines (the run lock is process-local). Use `cypress-explain` to explain or review a test without changing it. Use `cypress-author` to create, update, or fix a spec.
