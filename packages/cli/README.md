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
  dev worker           # run the local Supabase worker
  dev imagor           # run the local Imagor container
```

Commands that need linked SST resources auto-bootstrap through
`bunx --no-install sst --stage <stage> shell` when the current environment is
not already an `sst shell` child.
