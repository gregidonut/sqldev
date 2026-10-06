# SQLDev project knowledge

Curated source map for future tasks. Update it only under the rules in [../SKILL.md](../SKILL.md).

## Source map

| Concern | Authored source |
| --- | --- |
| App composition | `sst.config.ts` imports `infra/realtime.ts`, `infra/api.ts`, and `infra/web.ts`; storage is returned from `infra/storage.ts` |
| Stage behavior | Production is protected and retained. The `dev` stage skips the VPC and NAT EIP in `infra/vpc.ts` |
| Secrets | `infra/secrets.ts` declares SST secrets. `sst-env.d.ts` is generated from linked resources |
| Resource injection | `packages/core/src/envBuilder/index.ts` |
| Command wrappers | `packages/scripts/src/sb/index.ts`, `packages/scripts/src/cy/index.ts`, `packages/scripts/src/s3/index.ts` |
| Wrapper script | `packages/scripts/package.json` registers only `shell` (`sst --stage $STAGE shell bun`) |
| Local database | `packages/backend/supabase/config.toml` and `packages/backend/supabase/migrations/` |
| Browser tests | `packages/e2et/cypress.config.ts`, `packages/e2et/cypress/e2e/`, `packages/e2et/cypress/tasks/` |
| Go module | `packages/functions/go.mod` |
| HTTP contract | `packages/functions/cmd/goapi/api.yaml` and `config.yaml`; handlers are in `api/impl.go` and adjacent files |
| Realtime authorizer | `packages/functions/cmd/realtimeAuthorizer/main.go`, wired by `infra/realtime.ts` |
| Frontend config | `packages/frontend/astro.config.mjs`, `packages/frontend/package.json` |
| Auth middleware | `packages/frontend/src/middleware.ts` |
| Theme tokens | `packages/frontend/src/styles/global.css` |
| Upload flow | `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/forms/useStorageUppy.ts` and `packages/frontend/src/pages/api/storage/[...path].ts` |
| MQTT client | `packages/frontend/src/components/react/hooks/useMqtt/index.ts` |
| Client store | `packages/frontend/src/components/react/DDrvList/store/store.ts` |

## Workspace packages

`package.json` includes `packages/*`:

| Package | Role |
| --- | --- |
| `@sqldev/backend` | Supabase CLI project |
| `@sqldev/core` | Shared SST resource helpers used by scripts and tests |
| `@sqldev/e2et` | Cypress |
| `@sqldev/frontend` | Astro application |
| `@sqldev/functions` | Go Lambda code |
| `@sqldev/scripts` | SST-shell entry points |
| `@sqldev/agent-skills` | This skill package |

## Boundaries verified from source

- `infra/api.ts` defines `sst.aws.ApiGatewayV1` named `GoApi`. The Lambda receives `events.APIGatewayProxyRequest`. Older "API Gateway v2" wording does not describe the current resource.
- `infra/realtime.ts` defines `sst.aws.Realtime`. Application MQTT is AWS IoT. `packages/backend/supabase/config.toml` sets `[realtime] enabled = false`.
- `infra/web.ts` attaches the Astro Lambda to `sqldevSupabaseVPC` only outside `dev`. `infra/api.ts` does not attach the Go API Lambda to that VPC.
- `packages/frontend/astro.config.mjs` sets `output: "server"` and imports `astro-sst`. That package is the `astro-sst` dependency in `packages/frontend/package.json`.
- Clerk server auth is `@clerk/astro` in `packages/frontend/src/middleware.ts`. Public routes are `/`, `/sign-in`, and `/sign-up`; other pages redirect, and `/api` returns 401.
- `packages/e2et/cypress/tasks/localDbReset.ts` allows database cleanup only for stages `dev`, `local`, and `development`.
- `packages/functions/cmd/goapi/api/api.gen.go` is oapi-codegen output. No `go:generate` directive is committed.
- `packages/frontend/src/utils/supabase/models/` is gitignored generated output.

## Authorization entry points

- `packages/backend/supabase/migrations/20260403100059_create_function_get_owner.sql` maps the Clerk subject to the internal user.
- Later `establish_rbac_on_*` migrations add the application roles, permission checks, and RLS policies. Read the defining migration for the table being changed.
- `packages/backend/supabase/migrations/20260520180550_create_function_notify_http_post.sql` is the HTTP notify primitive used toward the Go API.

## Connected local tools

- `user-postgres-dev` queries the local Supabase database. It does not replace migrations.
- Astro docs MCP and React Aria MCP are the documentation sources for those frameworks.
- Exact dependency versions belong to each package's `package.json`, not this file.
