#!/usr/bin/bash
# Runs imagorvideo on an internal loopback port and the imagorproxy front door
# on the public port. imagorvideo keeps every env var it was given (secret,
# signer, S3 loader, ffmpeg limits); only its bind address is forced to the
# internal port so the proxy owns the public one.
set -eu

PUBLIC_PORT="${PORT:-8000}"
INTERNAL_PORT="${IMAGOR_INTERNAL_PORT:-8010}"

# Point imagorvideo at the loopback port. SERVER_ADDRESS stays 0.0.0.0 inside
# the container so the proxy (also in-container) can reach it on 127.0.0.1.
export PORT="${INTERNAL_PORT}"
export SERVER_ADDRESS="0.0.0.0"

/usr/local/bin/imagorvideo &
IMAGOR_PID=$!

# If imagorvideo dies, take the whole container down so the supervisor restarts
# a clean pair rather than leaving an orphaned proxy.
term() {
    kill "${IMAGOR_PID}" 2>/dev/null || true
    exit 0
}
trap term TERM INT

PROXY_ADDRESS="0.0.0.0:${PUBLIC_PORT}" \
UPSTREAM_URL="http://127.0.0.1:${INTERNAL_PORT}" \
    /usr/local/bin/imagorproxy &
PROXY_PID=$!

# Exit when either process exits.
wait -n "${IMAGOR_PID}" "${PROXY_PID}"
kill "${IMAGOR_PID}" "${PROXY_PID}" 2>/dev/null || true
