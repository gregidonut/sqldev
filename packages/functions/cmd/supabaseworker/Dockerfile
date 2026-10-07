FROM golang:1.25.1 AS build
WORKDIR /src
COPY packages/functions /src/packages/functions
COPY packages/backend/supabase/migrations /migrations
COPY packages/backend/selfhost/init/00-roles.sql /roles.sql
WORKDIR /src/packages/functions
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/worker ./cmd/supabaseworker

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/worker /usr/local/bin/worker
COPY --from=build /migrations /migrations
COPY --from=build /roles.sql /roles.sql
USER 65534:65534
ENTRYPOINT ["worker"]
