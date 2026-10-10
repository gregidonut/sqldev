# SQLDev project knowledge

Curated source map for future tasks. Update it only under the rules in [../SKILL.md](../SKILL.md).

## Source map

| Concern | Authored source |
| --- | --- |
| App composition | `sst.config.ts` imports `infra/realtime.ts`, `infra/api.ts`, and `infra/web.ts`; `infra/api.ts` imports `infra/jobs.ts` and `infra/host.ts`; storage is returned from `infra/storage.ts` |
| Stage behavior | Production is protected and retained. The `dev` stage skips the VPC and NAT EIP in `infra/vpc.ts` |
| Secrets | `infra/secrets.ts` declares SST secrets. `sst-env.d.ts` is generated from linked resources |
| Resource injection | `packages/core/src/envBuilder/index.ts` |
| Command wrappers | `packages/scripts/src/sb/index.ts`, `packages/scripts/src/cy/index.ts`, `packages/scripts/src/s3/index.ts`, `packages/scripts/src/replacehost/index.ts` |
| Wrapper script | `packages/scripts/package.json` registers only `shell` (`sst --stage $STAGE shell bun`) |
| Local database | `packages/backend/supabase/config.toml` and `packages/backend/supabase/migrations/` |
| Browser tests | `packages/e2et/cypress.config.ts`, `packages/e2et/cypress/e2e/`, `packages/e2et/cypress/tasks/` |
| Go module | `packages/functions/go.mod` |
| HTTP contract | `packages/functions/cmd/goapi/api.yaml` and `config.yaml`; handlers are beside `api/api.gen.go`. Regenerate with `go generate` in `packages/functions/cmd/goapi` |
| Realtime authorizer | `packages/functions/cmd/realtimeAuthorizer/main.go`, wired by `infra/realtime.ts` |
| Frontend config | `packages/frontend/astro.config.mjs`, `packages/frontend/package.json` |
| Auth middleware | `packages/frontend/src/middleware.ts` |
| Theme tokens | `packages/frontend/src/styles/global.css` |
| Upload flow | `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/forms/useStorageUppy.ts`. Astro `src/fetch.ts` forwards `/api/**` to the Go API |
| Storage thumbnails | `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/queryOptions/createThumbnailGet.ts` requests a 512×320 WebP poster for images, the first PDF page, and one video frame. Video tiles request a second looping WebP while hovered or focused and show server-reported frame progress. A failed or broken animation falls back to the poster without an error. `packages/frontend/src/server/requestJob.ts` stops polling after 60 attempts with a `504`, and animations poll every 200 ms, so an animation has about 12 seconds from submission |
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

- `infra/api.ts` defines `sst.aws.ApiGatewayV1` named `GoApi`. The Lambda receives `events.APIGatewayProxyRequest` and uses `GoApiRole`. Setting `role` replaces SST's default function role, so that role allows `appsync:*` in the `dev` stage for the live Lambda bridge. Outside `dev` it is attached to `sqldevSupabaseVPC`. Supabase-backed operations return `202` and a job id; `GET /api/jobs/{jobId}` is owner-scoped. `/notify`, `/renderMd`, and Clerk profile lookup stay synchronous. Older "API Gateway v2" wording does not describe the current resource.
- `infra/jobs.ts` defines the standard `JobQueue`, its dead-letter queue, the `JobStatus` DynamoDB table, and the private `JobResultBucket`. Queue access is granted on `GoApiRole` and `HostRole`, not through the queue component link. Outside `dev`, `infra/api.ts` denies other principals from sending or receiving, but it does not deny `sqs:GetQueueAttributes`, because the deploying principal must read queue attributes to apply the policy.
- `infra/host.ts` creates the private Supabase EC2 host outside `dev`. Postgres data and Docker images live on `HostDataVolume`, a gp3 volume (`HOST_VOLUME_GB`, default 30) that is reattached when the instance is replaced. The root volume is 8 GB and is deleted with the instance. The host has no SSH key and no inbound rule; reach it with SSM (`aws ssm start-session`), and forward its loopback Postgres with `packages/scripts/src/hostdb/index.ts`. `packages/backend/selfhost/bootstrap.sh` applies `init/00-roles.sql` as `supabase_admin`, the image superuser, and the migrations as `postgres`. Supabase Storage is not deployed there, so `00-roles.sql` creates the `storage.objects` table the migrations reference. `packages/functions/cmd/supabaseworker/migrate.go` records applied files in `supabase_migrations.schema_migrations` and applies each file in its own transaction. `packages/functions/cmd/supabaseworker` is the single-concurrency DBOS consumer. DBOS state lives in the `dbos` schema of that Postgres instance. `POST /api/images/transform` queues an idempotent `imagor` job on that same queue. `packages/backend/selfhost/imagor/Dockerfile` builds imagorvideo v1.2.0 on the pinned ffmpeg base and applies `progress.patch`. `infra/host.ts` pushes the digest to a private ECR repository, and the bootstrap runs it on `127.0.0.1:8000` with SHA-256 signatures, the HTTP loader disabled, and the app bucket as its only S3 loader. PDF posters use Imagor's first page, video posters use imagorvideo's selected frame, and animated previews use its `gif(3s,6)` WebP filter capped by `FFMPEG_MAX_ANIMATION_FRAMES=18`. The patch publishes the computed completed/total frame count on loopback `:8001`; the worker stores that progress on the owner-scoped job. The worker authorizes the storage key inside the database transaction, calls Imagor afterward, and stores the image in `JobResultBucket`. Owner-scoped job polling returns a five-minute presigned URL. The old `ImgproxyUrl` secret is not linked.
- Imagor jobs get one stable job id per idempotency key (`packages/functions/internal/jobs/jobs.go`: `Mutation` includes `KindImagor`). The DynamoDB status record expires after 24 hours (`packages/functions/cmd/goapi/api/submit.go`), but nothing prunes DBOS workflow rows (no retention is configured in `packages/functions/cmd/supabaseworker/main.go`), and DBOS treats a workflow id as an idempotency key that never reruns a finished workflow. A thumbnail requested after its record expired would therefore be attached to the old workflow and stay `pending` forever. `chooseWorkflowID` in `cmd/supabaseworker/main.go` gives a pending Imagor record whose workflow already finished a new workflow id derived from the record's expiry. It leaves other job kinds alone because they must run once per key, so they still have that gap. Tests are in `cmd/supabaseworker/main_test.go`.
- Imagor runs differently in each environment. Locally, `packages/scripts/src/imagor/index.ts` starts the image built from `packages/functions/cmd/imagorproxy`, which fakes progress in front of stock imagorvideo. On the host it is the patched build from `packages/backend/selfhost/imagor/Dockerfile`, configured by the env list in `packages/backend/selfhost/bootstrap.sh`. Any limit in that list must also be in the local script, or a render that works locally fails on the host. `packages/backend/selfhost/imagor/deploy_test.sh` pins `VIPS_MAX_RESOLUTION` in both files. The cap is applied to the whole animation, not one frame (reproduced against imagorvideo v1.2.0): an 18-frame 1080p clip is about 37 MP and failed under 16.7 MP, while its 2 MP poster passed. Under the cap, Imagor answers `422 maximum resolution exceeded` for the animation and the tile quietly keeps the poster. The 4K source took about 21 seconds to animate even on a large machine, which is over the host's 20 second `IMAGOR_PROCESS_TIMEOUT`, so 4K sources are still expected to fall back to the poster.
- A change to `packages/backend/selfhost/bootstrap.sh` changes the user-data hash and replaces the EC2 instance (`infra/host.ts`: `BOOTSTRAP_SHA`, `userDataReplaceOnChange`), so the instance id changes. Find the current one by its `Name` tag, `<app>-<stage>-supabase`. The worker and Imagor run as the systemd units `sqldev-worker` and `sqldev-imagor` (`bootstrap.sh`), readable with `journalctl -u` over SSM. A failed render is logged by the worker as an `imagor render` warning with the cause (`packages/functions/cmd/goapi/api/images.go`); Imagor's own error is in its journal.
- `packages/frontend/src/fetch.ts` is the Astro 7 advanced-routing entrypoint. Non-API requests use `astro()`. `/api/**` requests run Clerk middleware, require a signed-in user, and forward the native Clerk session JWT to Go. Browser API URLs are unchanged.
- Go calls Supabase with that Clerk JWT as the bearer token and the publishable key as `apikey`, so `auth.jwt()`, RLS, and the storage RPCs stay user-scoped. It does not use the service role for those calls. `infra/storage.ts` keeps `SQLDevBucket` private.
- `infra/realtime.ts` defines `sst.aws.Realtime`. Application MQTT is AWS IoT. `packages/backend/supabase/config.toml` sets `[realtime] enabled = false`.
- `infra/web.ts` attaches the Astro Lambda to `sqldevSupabaseVPC` only outside `dev`. `infra/api.ts` attaches the Go API Lambda to that same VPC outside `dev`.
- `packages/frontend/astro.config.mjs` sets `output: "server"` and imports `@sst-community/astro-sst`. Its server entry calls `createApp().render()` without a prior route match, so `packages/frontend/src/fetch.ts` handles `/api/**` in the deployed Lambda. There is no `pages/api` catch-all.
- Clerk server auth is `@clerk/astro`. `packages/frontend/src/middleware.ts` only attaches `clerkMiddleware()`. `packages/frontend/src/utils/clerk/requireAuth.ts` redirects unsigned pages to sign-in. `/` and `/sign-in` stay public; other pages, including `404.astro`, call the page helper. API authentication is enforced in `packages/frontend/src/fetch.ts`.
- `packages/e2et/cypress/tasks/localDbReset.ts` allows database cleanup only for stages `dev`, `local`, and `development`.
- `packages/functions/cmd/goapi/api/api.gen.go` is oapi-codegen output. `packages/functions/cmd/goapi/generate.go` pins the generator command.
- `packages/frontend/src/utils/supabase/models/` is gitignored generated output.

## Authorization entry points

- `packages/backend/supabase/migrations/20260403100059_create_function_get_owner.sql` maps the Clerk subject to the internal user.
- Later `establish_rbac_on_*` migrations add the application roles, permission checks, and RLS policies. Read the defining migration for the table being changed.
- `packages/backend/supabase/migrations/20260520180550_create_function_notify_http_post.sql` is the HTTP notify primitive used toward the Go API.

## Connected local tools

- `user-postgres-dev` queries the local Supabase database. It does not replace migrations.
- Astro docs MCP and React Aria MCP are the documentation sources for those frameworks.
- Exact dependency versions belong to each package's `package.json`, not this file.
