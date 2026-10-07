---
name: understanding-sqldev
description: >
  Loads mandatory SQLDev project context before any repository task: SST
  infrastructure, the packages/scripts shell, Supabase schema and RBAC, the Go
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
| Linked dev commands | `packages/scripts`, `packages/core/src/envBuilder` | — |
| Database | `packages/backend/supabase/migrations`, `packages/backend/supabase/config.toml` | generated Supabase types |
| Go HTTP contract | `packages/functions/cmd/goapi/api.yaml`, `config.yaml` | `packages/functions/cmd/goapi/api/api.gen.go` |
| Frontend | `packages/frontend` | — |
| Browser tests | `packages/e2et/cypress` | — |

The frontend adapter is the `astro-sst` submodule at `packages/astro-sst`. The installable package is `packages/astro-sst/packages/astro-sst`, linked from `packages/frontend/package.json`. Its Lambda entry uses Astro's automatic server entrypoint, so deployed requests run `packages/frontend/src/fetch.ts` before page matching.

## SST and commands

SST is the TypeScript infrastructure for this AWS application in `ap-east-1`. Keep long-lived configuration in `infra/secrets.ts`. A process environment variable is acceptable for a quick local test; move that value into an SST secret when it should remain.

Commands that need linked resources start in `packages/scripts`:

```bash
cd packages/scripts
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' STAGE=dev bun run shell src/cy -- run --headless --browser chrome
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' STAGE=dev bun run shell src/cy -- open
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' STAGE=dev bun run shell src/sb -- db reset
AWS_PROFILE='folio_api_admin' AWS_REGION='ap-east-1' STAGE=dev bun run shell src/sb -- stop
```

`shell` runs `sst shell`. The Supabase and Cypress wrappers in `packages/core/src/envBuilder` inject linked resource values. Do not invoke those CLIs from a bare shell. `src/s3` deletes objects from the linked bucket; run it only when the task explicitly requests that deletion.

## Supabase

Local Supabase is the CLI project at `packages/backend/supabase`. Start and stop it through `src/sb`. The `user-postgres-dev` MCP is the local dev database; use it to inspect that database. Schema changes still belong in migrations.

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

Tests live in `packages/e2et/cypress` and run through `src/cy`. Database cleanup refuses any stage other than `dev`, `local`, or `development`. Use `cypress-explain` to explain or review a test without changing it. Use `cypress-author` to create, update, or fix a spec.
