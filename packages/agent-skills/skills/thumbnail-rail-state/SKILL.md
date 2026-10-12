---
name: thumbnail-rail-state
description: >
  Explains the thumbnail "loading bar" (progress rail) state machine in the
  SQLDev frontend: where it lives, the keyed-per-tile Zustand store pattern, the
  invalid-states-unrepresentable discriminated-union constraint, the per-entry
  timer/token ownership rule, and the rule that TanStack Query stays the single
  progress source while the store is never persisted. Load before changing the
  thumbnail progress rail, its store, or the hook/component that consume it.
---

# Thumbnail Rail State

The "loading bar" is the thumbnail progress rail shown while a video thumbnail animation is being generated and loaded. Read this skill before changing the rail, its store, or the code that consumes them. Trust current source over this document; the governing skills below are authoritative on the underlying patterns.

Governing skills — load them when touching this area:

- `valid-state-types` — model state so invalid combinations are unrepresentable.
- `tagged-unions` — discriminated unions with a `state` tag and exhaustive narrowing.
- `react-doctor` — run after any React change here and confirm the health score does not regress.

## (a) Where the rail state lives

- Store: `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/store/thumbnailRailStore.ts` — the Zustand store (`useThumbnailRailStore`) that owns the per-tile rail lifecycle, readiness, poster slice, and the side-effecting timer/token identity.
- Consumer: `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/StorageThumbnail.tsx` — contains the `useThumbnailPreview` hook (bridges TanStack Query / DOM image events into store actions and selects the derived view back out), the `railView()` derivation, and the `ThumbnailProgressRail` component (renders a `react-aria` `ProgressBar`, or a failed `role="status"` rail).

The store is in the same `store/` folder as `storageTableStore.ts`, matching the established in-folder store pattern.

## (b) Keyed-per-tile Zustand store pattern

The store holds a `ReadonlyMap<string, TileRail>` keyed by `sourceKey`. Each thumbnail tile reads and writes only its own entry, mirroring the real domain (N independent thumbnails, each with its own attempt id, dismissal token, and failure timer).

Rules:

- Reads go through a selector keyed by `sourceKey` (e.g. `(s) => s.getTile(sourceKey)`), so a mutation to tile A does not re-render tile B.
- `getTile` MUST return a **reference-stable shared default** for absent keys. Returning a freshly-constructed object each call causes render loops; return one shared frozen default instance instead.
- Writes are **single-key immutable updates**: build a new `Map` with only the touched entry replaced, leaving every other entry's identity intact. This preserves tile isolation — a mutation for one `sourceKey` never changes another entry.

Do not collapse the keyed map into a single global lifecycle. A single shared lifecycle couples unrelated tiles and reintroduces cross-tile bugs the per-tile entries avoid.

## (c) Invalid states are unrepresentable

The lifecycle is modeled as discriminated unions so impossible combinations cannot be constructed (per `valid-state-types` and `tagged-unions`):

- `AnimationLifecycle` — `inactive` | `initial-wait` | `frames` | `final-wait` | `ready` | `failed`. A `frames` state cannot exist without `completed`/`total`; a `ready` state cannot exist without a verified `url`; a `failed` state cannot exist without a `reason` and a `dismissalToken`.
- `AnimationUrlReadiness` — `absent` | `loading` | `decoding` | `ready` | `broken`.
- `PosterLoadState` — `idle` | `loading` | `ready` | `broken`.

Constraints:

- NEVER flatten these unions into loose optional fields (e.g. a bag of `url?`, `completed?`, `reason?`). The union variants carry exactly the fields valid for that state and nothing else.
- Each union is tagged with a `state` string-literal discriminant so narrowing and exhaustiveness checks work.
- Use an `assertNever(x)` exhaustiveness guard in the `default` branch of any switch over these tags, so adding a new variant becomes a compile error at every consumer.

## (d) Timer / token ownership

The side-effecting identity that previously lived in React refs is now per-entry fields of `TileRail`, owned **exclusively by store actions**:

- `attempt` — a monotonic `AnimationAttemptId` counter. `beginAttempt` strictly increases it; late callbacks carrying a stale `attempt` are no-ops.
- `dismissalToken` — a monotonic counter bumped on each failure.
- `failureTimer` — the `setTimeout` handle for the `FAILURE_VISIBLE_MS` (1000 ms) auto-dismiss. Non-serializable.

Rules:

- These fields are mutated only inside store actions — primarily `beginAttempt`, `endAttempt`, and `failAttempt`. They are NOT component refs after the migration.
- **At most one live timer per tile.** Scheduling a new failure timer first clears any existing one; `beginAttempt`, `endAttempt`, and unmount cleanup all clear the pending timer.
- The auto-dismiss transition to `inactive` is **guarded by attempt + dismissalToken identity**: when the timer fires it only dismisses if the entry is still `failed` with the same `attempt` and `dismissalToken` that scheduled it; otherwise it is a no-op. This prevents a superseded timer from clobbering a newer attempt.
- The store is the single owner of timer cleanup. On unmount, the hook calls `endAttempt`, which clears the `setTimeout`, preventing a leaked timer or a setState-after-unmount.

## (e) TanStack Query is the single progress source; the store is never persisted

Progress source:

- TanStack Query remains the **single** source of progress data. The animation `useQuery`'s `onProgress` callback (`JobProgress = { phase, completed, total }` from `@/server/requestJob`) is bridged into the store's `reportProgress` action.
- The store is a **progress consumer only** — it never fetches. Query errors and browser image load/error/decode events are likewise reported into the store through actions.

Persistence:

- The store uses plain `create<T>()(...)` with **no `persist` middleware**. Unlike `storageTableStore.ts` (which persists user preferences), the rail lifecycle is ephemeral runtime state tied to in-flight jobs and image loads.
- It MUST NOT be persisted: it holds a non-serializable `setTimeout` handle, and a page reload must start clean (no stale in-flight lifecycle restored from `localStorage`).

## Related source

- `packages/frontend/src/pages/drive/[driveTab]/_components/react/RACCRUDTable/storage/store/storageTableStore.ts` — the persisted preferences store (the pattern this store deliberately diverges from on persistence).
- `@/server/requestJob` — the `JobProgress` type and `onProgress` progress source.
