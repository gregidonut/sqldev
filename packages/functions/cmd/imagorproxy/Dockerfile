# syntax=docker/dockerfile:1
#
# Builds the sqldev imagor image: the stock imagorvideo renderer plus the
# imagorproxy front door that adds the /progress/{id} endpoint and understands
# the progress(id,token) render filter. The proxy listens on the public port,
# strips and re-signs the progress filter, and forwards to imagorvideo on an
# internal loopback port.
#
# Build context is the repo root so the Go module copies cleanly:
#   docker build -f packages/functions/cmd/imagorproxy/Dockerfile -t sqldev-imagor:test .

FROM golang:1.25.1 AS build
WORKDIR /src
COPY packages/functions /src/packages/functions
WORKDIR /src/packages/functions
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/imagorproxy ./cmd/imagorproxy

# The base already ships imagorvideo with libvips and ffmpeg, so reuse it
# instead of rebuilding that heavy toolchain.
FROM sqldev-imagor:base
COPY --from=build /out/imagorproxy /usr/local/bin/imagorproxy
COPY packages/functions/cmd/imagorproxy/entrypoint.sh /usr/local/bin/sqldev-imagor-entrypoint.sh
USER root
RUN chmod +x /usr/local/bin/sqldev-imagor-entrypoint.sh
USER 65534:65534
ENTRYPOINT ["/usr/local/bin/sqldev-imagor-entrypoint.sh"]
