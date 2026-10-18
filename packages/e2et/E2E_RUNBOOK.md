# SQLDev E2E Runbook

The Cypress harness is stage-aware. Changing only `--stage` selects the target
frontend, the Clerk/Supabase resources, and the two Clerk test users. There is
no `cypress.env.json`.

## Test users

Test users come from the `CyTestUsersJson` SST secret for the selected stage. It
accepts either a bare JSON array of exactly two distinct objects, each with only
a `user_id` string, or the legacy `cypress.env.json` wrapper object (so a direct
`cat cypress.env.json` into the secret works):

```json
[{ "user_id": "<A>" }, { "user_id": "<B>" }]
```

```json
{ "test_users": [{ "user_id": "<A>" }, { "user_id": "<B>" }] }
```

Set it per stage with SST (values are never printed by the harness):

```bash
bunx --no-install sst secret set CyTestUsersJson '<json>' --stage dev
bunx --no-install sst secret set CyTestUsersJson '<json>' --stage staging
```

`signInAsUser(0)` / `signInAsUser(1)` map to array indices 0 and 1.

## Targets

- `dev` → `http://localhost:4321` (local Astro). Never consults deployed values.
- `staging` → linked `Frontend.url`, cross-checked against `AstroAppDomain`
  (they must normalize to the same origin, e.g. `https://dev.sqldev.gregosilaja.cc`).

Every root visit asserts the page stays on the expected origin.

## Running

Dev smoke (local Astro + local Supabase must be up):

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage dev cypress run --headless --browser chrome \
  --spec cypress/e2e/stageSmoke.cy.ts
```

Full dev suite:

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage dev cypress run --headless --browser chrome
```

Staging smoke, then full suite (runs the destructive staging reset first):

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging cypress run --headless --browser chrome \
  --spec cypress/e2e/stageSmoke.cy.ts

AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging cypress run --headless --browser chrome
```

## Staging reset (destructive)

Staging application data is disposable. Before every `staging` run the suite
runs `sqldev --stage staging e2e reset`, which:

- truncates the audited application tables (shared asset
  `packages/cli/internal/e2ereset/application_reset.sql`) over SSM on the host;
- empties only `SQLDevBucket`.

It preserves Clerk users, DBOS history, queues/DLQ, job-status records, and
`JobResultBucket`. It runs only when the configured stage and linked `App.stage`
are both exactly `staging`, the frontend/domain origins agree, exactly one
tagged staging host resolves, and the application and job-result buckets differ.
Database credentials never leave the host.

Validate without mutating:

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging e2e reset --preflight
```

Run it manually (prompts to confirm; `--yes` skips):

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging e2e reset
```

## Limits

- `E2E_FULL_DB_RESET=1` is local-only (dev/local/development) and refused for staging.
- The whole-bucket `emptyBucket` Cypress task is local-only.
- The run lock is process-local; serialize staging runs across machines/CI yourself.
- S3 deletion is not transactional: a partial failure reports completed effects;
  rerun from a fresh preflight/reset.

## Fresh staging data volume

`sst deploy` and `sqldev host replace` replace the EC2 instance and reattach the
same EBS data volume. PostgreSQL, DBOS history, Docker data, and Vault stay on
that volume. Bootstrap applies migration files whose versions are not already in
`supabase_migrations.schema_migrations`; it does not rerun a version that was
edited after it was recorded. A staging Cypress failure caused by that preserved
database is not fixed by replacing the instance again.

`sqldev host data-volume replace` is exact-`staging` only. It terminates the
host, deletes the linked data volume, and redeploys so bootstrap formats an empty
volume and applies every current migration. It then restores the three trigger
Vault secrets. The deletion is permanent: PostgreSQL, migration history, DBOS,
Docker data, and Vault on the volume are destroyed, and a failed deploy can leave
staging without a host or volume. It does not delete Clerk users, S3 objects,
queues, or job status. There is no rollback.

Deploy the volume identity tags and `HostDataVolumeId` link, rebuild the CLI,
and install it before the first run. Preflight validates the host and volume
without changing them:

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging host data-volume replace --preflight
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 \
  sqldev --stage staging host data-volume replace
```

## Prerequisites that must hold for staging

The host's Vault must contain the three secrets the database triggers read.
`host replace` keeps the data volume, so those secrets survive it. A fresh
volume starts empty; `host data-volume replace` restores them itself. Check or
provision them directly when they are missing:

```bash
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 sqldev --stage staging host vault sync --preflight
AWS_PROFILE=folio_api_admin AWS_REGION=ap-east-1 sqldev --stage staging host vault sync
```

Without them posts store no rendered HTML and no MQTT notify is sent, so the
edit-heading and live-update specs fail. The command is exact-`staging` only,
prints secret names (never values), and is idempotent. SSM keeps command
parameters in its history, so the notify secret is visible to principals that can
read SSM commands in the account; rotate `NotifySecret` and re-run if that matters.

Seeding on staging goes through the deployed frontend's `/api/*` proxy, because
staging's Supabase is a private VPC address and the Go API Gateway only accepts
the app's NAT egress IP.

Validated with bounded, redacted checks before the reset: Clerk testing-token
and dev-browser flows, the `supabase` Clerk JWT template for both users,
frontend/Go-API/Supabase reachability, operator SSM command permission on the
host, and operator S3 list/delete permission on the application bucket. Failures
name the prerequisite and a category only.
