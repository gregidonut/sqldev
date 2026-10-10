# A repo of integration tricks with the techstack

currently hosted at https://dev.sqldev.gregosilaja.cc

## Developer CLI

Linked developer commands run through the `sqldev` Go CLI in `packages/cli`. It
loads SST linked resources from the environment and automatically re-executes
itself through `sst shell` when they are not present, so no manual
`bun run shell` wrapper is needed.

Build it (the local gcc cannot link cgo, so disable it):

```bash
CGO_ENABLED=0 go -C packages/cli build -o "$HOME/.local/bin/sqldev" .
```

Common commands:

```bash
# Transparent Supabase and Cypress wrappers — every argument is forwarded.
sqldev --stage dev supabase db reset
sqldev --stage dev cypress run --headless --browser chrome

# Linked bucket maintenance.
sqldev --stage dev storage empty --yes
sqldev --stage dev storage delete key/one key/two

# Deployed host operations (refused on dev).
sqldev --stage staging host database tunnel
sqldev --stage staging host replace --yes

# Local dev services.
sqldev --stage dev dev worker
sqldev --stage dev dev imagor
```

Configuration precedence is flag, then `SQLDEV_*` env, then a compatible legacy
env (`STAGE`, `AWS_PROFILE`, ...), then an optional `.sqldev.yaml`, then
defaults. See `.kiro/specs/go-cli-consolidation/design.md` for the full design.
