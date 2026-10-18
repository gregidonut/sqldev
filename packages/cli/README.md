# sqldev CLI

The `sqldev` developer CLI consolidates the former `packages/core` and
`packages/scripts` into one Go executable. It provides transparent Supabase and
Cypress wrappers, linked-bucket storage maintenance, deployed-host operations,
and local dev services.

## Build

The local toolchain cannot link cgo, so build with it disabled:

```bash
CGO_ENABLED=0 go build -o /tmp/sqldev .
```

## Test

```bash
CGO_ENABLED=0 go test ./...
CGO_ENABLED=0 go vet ./...
```

## Command tree

```text
sqldev
  supabase [args...]   # alias: sb — transparent Supabase CLI wrapper
  cypress  [args...]   # alias: cy — transparent Cypress CLI wrapper
  storage empty        # empty the linked SQLDevBucket (needs --yes non-interactively)
  storage delete KEY...# delete specific keys (dedupe, 1000-batches)
  host database tunnel # SSM Postgres port-forward to the deployed host
  host replace         # replace the host, preserving its data volume (needs --yes)
  host data-volume replace
                       # exact staging: delete the data volume, redeploy, restore Vault
  dev start            # start sst/worker/imagor in managed tmux panes
  dev stop             # stop the managed session and clean up the Imagor container
  dev restart          # restart all managed local services
  dev restart --reset-data   # restart and run the combined S3 + Supabase reset
  dev status           # show per-pane state (human or --output json)
  dev attach           # attach, or switch-client when already inside tmux
  dev reset-data       # empty linked S3 then `supabase db reset --local --no-seed`
  dev sst     [--foreground]  # restart the sst pane, or run it attached
  dev worker  [--foreground]  # restart the worker pane, or run it attached
  dev imagor  [--foreground]  # restart the Imagor pane, or run it attached
```

Commands that need linked SST resources auto-bootstrap through
`bunx --no-install sst --stage <stage> shell` when the current environment is
not already an `sst shell` child.

## Local development with tmux

`dev start`/`dev restart` own one tmux session per stage, `sqldev-<stage>`, with
a `services` window containing separately titled `sst`, `worker`, and `imagor`
panes. The orchestrator never enters `sst shell`; only the foreground panes and
`dev reset-data` acquire linked resources. Failed services stay visible as dead
panes (`remain-on-exit`). The orchestrator only touches a session carrying its
own `@sqldev-managed`/`@sqldev-stage`/`@sqldev-root` markers.

```bash
# Bring the whole local stack up and attach.
sqldev --stage dev dev restart --attach

# Peek at state without attaching.
sqldev --stage dev dev status

# Rebuild one service without disturbing the others.
sqldev --stage dev dev worker

# Nuke local data (empty S3, reset Supabase) and restart. Prompts once.
sqldev --stage dev dev restart --reset-data
```

`dev restart --reset-data` and `dev reset-data` only run for the `dev`, `local`,
and `development` stages. tmux settings live under `dev.tmux` in config and the
`SQLDEV_TMUX_*` environment variables.

## Staging data volume

`host replace` terminates the EC2 instance and redeploys it, then checks that the
same data volume reattached. PostgreSQL, migration history, DBOS, Docker data,
and Vault survive that replacement. A migration version already recorded in
`supabase_migrations.schema_migrations` is not applied again.

`host data-volume replace` is the exact-`staging` operation that deletes that
volume. Bootstrap then formats a new volume and applies the current migration
files. It restores the trigger Vault secrets after the new host is ready. Deploy
the `HostDataVolume` identity tags and `HostDataVolumeId` link, then install the
CLI that understands them, before the first run. There is no rollback.

```bash
sqldev --stage staging host data-volume replace --preflight
sqldev --stage staging host data-volume replace
```
