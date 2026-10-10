# Video hover progress bar: findings

Verified against the dev stack (local imagor container, local worker, deployed dev DynamoDB table).

## How progress flows

1. Hover on a video tile enables the `animation` query in `StorageThumbnail.tsx`.
2. The query POSTs `/api/images/transform` with a deterministic `Idempotency-Key`, then polls `/api/jobs/{id}`.
3. The worker (`imagor.Client.Render`) adds `progress(id,token)` to the signed path and polls `PROGRESS_URL/progress/{id}`.
4. The worker writes each change to the job row (`status.Dynamo.UpdateProgress`). `/api/jobs/{id}` returns it as `progress`.
5. `requestJob` hands it to `onProgress`, which renders `AnimationProgress`.

`cmd/imagorproxy` reports synthetic progress: the frame counter ticks 0 to 18 in about 2.7s, then holds at
`encoding 18/18` until imagorvideo answers. A bar parked at 100% means the render is still running.

## Defect fixed: progress writes were rejected by DynamoDB

`UpdateProgress` used `owner` unaliased in its `ConditionExpression`. `owner` is a DynamoDB reserved word, so every
write failed with `ValidationException`. The worker logged it at WARN and carried on, so no job ever carried
`progress`. The in-memory store used by tests cannot reject reserved words, so tests passed.

Fix: `#owner` alias in `internal/status/dynamo.go`, with a guard test (`dynamo_test.go`) that fails on an unaliased
reserved word. It was confirmed to fail on the old expression and pass on the new one.

After the fix a hover shows the bar through the real UI: 0% to 100% over `frames`, then `encoding`.

## Replayed jobs never show progress

The idempotency key is `thumb:<storageDataId>:animation:...`, so a file that already has a stored job replays its
stored result. A replayed job is already `completed`, so there is nothing to report. The bar only appears for a
first-time render.

## Open: animation renders exceed imagor's time limit

A direct signed request to imagor, with no worker and no progress filter, returns HTTP 408 after about 25s for the
3s@6fps animation of `WIN_20251119_00_55_32_Pro.mp4`. The still poster of the same file takes about 4.3s.
The worker then reports `Image processing timed out` (504) and no animated image is stored.

Not yet identified: which imagor setting produces the 408, and how long the render needs. Options to weigh:

- Raise imagor's request timeout, the worker's 25s render timeout (`cmd/goapi/api/images.go`) and the HTTP client
  timeout (`internal/imagor/imagor.go`) together. The SQS visibility timeout is 2 minutes (`infra/jobs.ts`).
- Lower `FFMPEG_MAX_ANIMATION_FRAMES` (currently 18 in `src/imagor/index.ts`), or shorten the clip.
- Pre-generate animations on upload instead of on hover.

## Diagnostics notes

- The worker now logs the cause of a failed render (`imagor render` WARN). Render errors never contain the signed URL.
- `go test` for packages that link cgo fails in this shell because the Nix gcc cannot find libc. Use `CGO_ENABLED=0`.
- Browser console tool: `list_console_messages` is paged oldest-first. Read the last page for fresh output.
- `cmd/imagorproxy` no longer logs each progress poll. To watch a render live, poll `/progress/{id}` directly or read
  the job record through `/api/jobs/{id}`.
