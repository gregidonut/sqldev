// Per-tile thumbnail progress-rail state, migrated out of the local React
// state inside `useThumbnailPreview` (see `../../StorageThumbnail.tsx`). The
// type scaffold and default-entry factory come from task 1.1; task 2.1 adds
// the keyed `create<T>()` store container, the `getTile` read path, and the
// store interface. The action bodies (begin/endAttempt, reportProgress,
// urlArrived, imageLoaded, imageDecoded, imageBroken, failAttempt, poster*)
// are declared here but implemented in tasks 2.2–6.1.
// See `.kiro/specs/loading-bar-zustand-store/design.md`.

import { create } from "zustand";
import type { JobProgress } from "@/server/requestJob";

// A monotonically increasing attempt identifier scoped to one mounted tile.
// Every eligibility interval gets a fresh id so results, image events, decode
// promises, and failure timers from a superseded attempt can be ignored.
export type AnimationAttemptId = number;

// Why a failure happened. Only used to pick an accessible status; the visible
// rail is identical for every reason. Cancellation is never a failure.
export type AnimationFailureReason =
    | "request"
    | "server"
    | "timeout"
    | "malformed-result"
    | "image-load"
    | "image-decode"
    | "zero-dimensions";

// The complete lifecycle of one animated-preview attempt. Modelled as a
// discriminated union so invalid combinations are unrepresentable: a
// determinate rail cannot exist without frame counts, a ready state cannot
// exist without a verified URL, and a failed rail cannot exist without a
// current attempt and dismissal identity.
export type AnimationLifecycle =
    | { readonly state: "inactive" }
    | { readonly state: "initial-wait"; readonly attempt: AnimationAttemptId }
    | {
          readonly state: "frames";
          readonly attempt: AnimationAttemptId;
          readonly completed: number;
          readonly total: number;
      }
    | {
          readonly state: "final-wait";
          readonly attempt: AnimationAttemptId;
          readonly phase: "encoding" | "image-download" | "image-decode";
      }
    | {
          readonly state: "ready";
          readonly attempt: AnimationAttemptId;
          readonly url: string;
      }
    | {
          readonly state: "failed";
          readonly attempt: AnimationAttemptId;
          readonly reason: AnimationFailureReason;
          readonly dismissalToken: number;
      };

// Browser readiness of the current animation URL. A query result URL is only
// `loading`; it becomes `ready` after a genuine load with positive natural
// dimensions and (when available) a successful decode for the same attempt and
// URL. A URL change invalidates events from the old URL.
export type AnimationUrlReadiness =
    | { readonly state: "absent" }
    | {
          readonly state: "loading";
          readonly attempt: AnimationAttemptId;
          readonly url: string;
      }
    | {
          readonly state: "decoding";
          readonly attempt: AnimationAttemptId;
          readonly url: string;
      }
    | {
          readonly state: "ready";
          readonly attempt: AnimationAttemptId;
          readonly url: string;
      }
    | {
          readonly state: "broken";
          readonly attempt: AnimationAttemptId;
          readonly url: string;
          readonly reason: "image-load" | "image-decode" | "zero-dimensions";
      };

// Poster readiness is tracked by the current poster URL. Server delivery of a
// URL is not the same as a successful browser image load, and a broken image
// can report `complete === true`, so animation only unlocks after a real
// `onLoad` for the URL that is currently rendered.
export type PosterLoadState =
    | { readonly state: "idle" }
    | { readonly state: "loading"; readonly url: string }
    | { readonly state: "ready"; readonly url: string }
    | { readonly state: "broken"; readonly url: string };

// A failure rail is held for this long and then dismissed by timer. The timer
// is authoritative because reduced-motion removes the shake animation, so an
// `animationend` event may never fire.
export const FAILURE_VISIBLE_MS = 1000;

// The per-tile store entry. The side-effecting identity (attempt /
// dismissalToken / failure timer handle) that today lives in component refs
// becomes explicit, co-located fields of the entry. The `failureTimer` handle
// is non-serializable, which is one reason the store MUST NOT be persisted.
export type TileRail = {
    readonly lifecycle: AnimationLifecycle;
    readonly readiness: AnimationUrlReadiness;
    readonly poster: PosterLoadState;
    // Authoritative monotonic counters, previously attemptRef / dismissalTokenRef.
    readonly attempt: AnimationAttemptId;
    readonly dismissalToken: number;
    // setTimeout handle for FAILURE_VISIBLE_MS auto-dismiss, previously failureTimerRef.
    readonly failureTimer: ReturnType<typeof setTimeout> | null;
};

// Pure factory for a fresh entry. Used by the store's `getTile` selector when a
// `sourceKey` is absent so reads return a stable inactive baseline.
export function createDefaultTile(): TileRail {
    return {
        lifecycle: { state: "inactive" },
        readiness: { state: "absent" },
        poster: { state: "idle" },
        attempt: 0,
        dismissalToken: 0,
        failureTimer: null,
    };
}

// Exhaustiveness guard for lifecycle (and other discriminated-union) switch
// `default` branches: adding a new variant without handling it becomes a
// compile-time error because the new variant is no longer assignable to `never`.
export function assertNever(x: never): never {
    throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

// Hard cap on the number of keyed tile entries the store will hold at once.
// The map is keyed per `sourceKey`; a mounted drive grid shows far fewer tiles
// than this, so the cap is a safety bound against unbounded growth from churn,
// never a limit reached in normal use. `beginAttempt` (task 3.1) is the only
// action that introduces a new key and is responsible for enforcing this bound.
export const MAX_TILE_ENTRIES = 10_000;

// Dimensions reported by the browser on image load, used to detect
// zero-dimension (broken) decodes exactly as the current onAnimationLoad does.
export type ImageDimensions = {
    readonly naturalWidth: number;
    readonly naturalHeight: number;
};

// A single shared default entry. `getTile` returns THIS reference for every
// absent `sourceKey`, so repeated reads of a missing key are reference-equal.
// This is required for selector stability: a React tile subscribing via
// `(s) => s.getTile(sourceKey)` must not re-render on every store change just
// because a fresh default object was minted on each read. The entry is deeply
// readonly, so sharing one instance is safe — nothing can mutate it in place.
const DEFAULT_TILE: TileRail = createDefaultTile();

// The terminal lifecycle states. Once a tile reaches `ready` or `failed`, only
// `beginAttempt`/`endAttempt` may leave that state (Requirement 4.5); progress,
// url, and image callbacks must not advance it. Centralized here so the guard
// used by `advanceCurrentAttempt` and the terminal-regression checks agree.
function isTerminalLifecycle(lifecycle: AnimationLifecycle): boolean {
    return lifecycle.state === "ready" || lifecycle.state === "failed";
}

// Internal reducer (module-private; NOT part of `ThumbnailRailStore`). Returns
// the entry with its `lifecycle` replaced by `next` ONLY when the caller's
// `attempt` is the entry's current attempt AND the entry is not already in a
// terminal state; otherwise returns `entry` unchanged by identity. This is the
// single home of the "only the current, non-terminal attempt may advance" guard
// reused by `reportProgress` (task 4.1), `urlArrived`, and `imageLoaded`
// (task 4.2). Keeping it pure and reference-preserving lets callers detect a
// no-op by `===` and skip the `set(...)` entirely.
//
// Validates design "advanceCurrentAttempt" spec; Requirements 4.3, 4.4, 4.5, 4.6.
function advanceCurrentAttempt(
    entry: TileRail,
    attempt: AnimationAttemptId,
    next: AnimationLifecycle,
): TileRail {
    if (attempt !== entry.attempt || isTerminalLifecycle(entry.lifecycle)) {
        return entry;
    }
    return { ...entry, lifecycle: next };
}

// Internal immutable write helper (module-private; NOT part of
// `ThumbnailRailStore`). Given the current `tiles` map, the `sourceKey` being
// touched, and the already-reduced `next` entry, returns a NEW `Map` in which
// ONLY that `sourceKey` is replaced and every OTHER key's entry is the exact
// same object reference it held before. This preserves tile isolation
// (Requirement 1.2 / design "Performance Considerations"): a mutation for one
// tile never changes the identity of any other tile's entry, so a selector
// subscribed to a different `sourceKey` does not re-render.
//
// When `next === tiles.get(sourceKey)` (a reducer no-op produced by
// `advanceCurrentAttempt`), the returned map is still a fresh container but
// every value — including the touched key — keeps its prior reference; callers
// that want to avoid even that allocation should compare before calling.
//
// Validates Requirement 1.2.
function writeTile(
    tiles: ReadonlyMap<string, TileRail>,
    sourceKey: string,
    next: TileRail,
): Map<string, TileRail> {
    const updated = new Map(tiles);
    updated.set(sourceKey, next);
    return updated;
}

// The store contract. `tiles` and `getTile` are the task 2.1 read path; the
// actions are declared here with their final design signatures but are
// implemented in later tasks (see the TODO markers on each body).
export interface ThumbnailRailStore {
    // Keyed per tile. Reading selects a single entry by `sourceKey`.
    readonly tiles: ReadonlyMap<string, TileRail>;

    // Pure read: returns the stored entry, or the shared reference-stable
    // default when the key is absent. Issues no network request and touches no
    // browser persistence mechanism.
    readonly getTile: (sourceKey: string) => TileRail;

    // --- Attempt lifecycle (task 3.1) ---
    readonly beginAttempt: (sourceKey: string) => void;
    readonly endAttempt: (sourceKey: string) => void;

    // --- Progress: TanStack Query onProgress bridge (task 4.1) ---
    readonly reportProgress: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        progress: JobProgress,
    ) => void;

    // --- Animation URL + browser readiness (task 4.2) ---
    readonly urlArrived: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        url: string,
    ) => void;
    readonly imageLoaded: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        url: string,
        dims: ImageDimensions,
    ) => void;
    readonly imageDecoded: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        url: string,
    ) => void;
    readonly imageBroken: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        url: string,
        reason: "image-load" | "image-decode" | "zero-dimensions",
    ) => void;

    // --- Failure + timed auto-dismiss, owns the setTimeout (task 5.1) ---
    readonly failAttempt: (
        sourceKey: string,
        attempt: AnimationAttemptId,
        reason: AnimationFailureReason,
    ) => void;

    // --- Poster slice (task 6.1) ---
    readonly posterReset: (sourceKey: string, url: string | undefined) => void;
    readonly posterLoaded: (
        sourceKey: string,
        url: string,
        naturalWidth: number,
    ) => void;
    readonly posterBroken: (sourceKey: string, url: string) => void;
}

// The keyed rail store. Deliberately plain `create<T>()(...)` with NO `persist`
// middleware (unlike the sibling `storageTableStore.ts`): the rail lifecycle is
// ephemeral runtime state tied to in-flight jobs, image loads, and a
// non-serializable `setTimeout` handle. It MUST reset on reload, so it is held
// in in-memory JavaScript references only and is never written to localStorage,
// sessionStorage, IndexedDB, or cookies. No action, selector read, or default
// resolution issues any network request.
export const useThumbnailRailStore = create<ThumbnailRailStore>()(function (
    set,
    get,
) {
    return {
        // Starts empty; a reload reconstructs this as a fresh empty map (zero
        // entries), never restored from any browser persistence mechanism.
        tiles: new Map<string, TileRail>(),

        getTile: function (sourceKey) {
            // Returns the stored entry when present, otherwise the single
            // shared default. The shared `DEFAULT_TILE` reference guarantees
            // repeated reads of an absent key are reference-equal with no
            // intervening mutation, and no persistence lookup is attempted.
            return get().tiles.get(sourceKey) ?? DEFAULT_TILE;
        },

        // --- Placeholder action bodies ---
        // Implemented in tasks 2.2–6.1. They are declared now with their final
        // signatures so the store type-checks and the hook refactor (task 8)
        // can reference them; the bodies intentionally do nothing yet. The
        // `set` updater and the per-tile reducers (`advanceCurrentAttempt`, the
        // immutable write helper, the `MAX_TILE_ENTRIES` enforcement, and the
        // `FAILURE_VISIBLE_MS` timer ownership) land in those tasks.

        // Eligibility turned on. Mirrors the hook's eligibility `useEffect`
        // in `../../StorageThumbnail.tsx`: `attemptRef.current += 1`, set
        // lifecycle to `initial-wait` with the new attempt, reset readiness to
        // `absent`, and `clearFailureTimer()`. The monotonic `attempt` is read
        // from the current entry (or the shared default when absent) and
        // incremented by EXACTLY 1, so it never regresses (Requirements 4.1,
        // 4.2, 4.3). This is the ONLY action that introduces a new key, so it
        // is also where `MAX_TILE_ENTRIES` is enforced.
        beginAttempt: function (sourceKey) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;

                // Clear any pending FAILURE_VISIBLE_MS timer so a superseded
                // attempt's failure is never recorded after a fresh begin.
                if (entry.failureTimer !== null) {
                    clearTimeout(entry.failureTimer);
                }

                const newAttempt = entry.attempt + 1;
                const next: TileRail = {
                    ...entry,
                    lifecycle: { state: "initial-wait", attempt: newAttempt },
                    readiness: { state: "absent" },
                    attempt: newAttempt,
                    failureTimer: null,
                };

                // Safety bound on map growth. `beginAttempt` is the only action
                // that can add a previously-absent key, so the cap is enforced
                // here. When adding a NEW key would exceed MAX_TILE_ENTRIES
                // (10,000) we refuse to grow beyond the cap and leave state
                // untouched; a mounted drive grid holds far fewer tiles than
                // this, so this branch is never reached in normal use. Touching
                // an already-present key never grows the map and is always
                // allowed.
                const isNewKey = !state.tiles.has(sourceKey);
                if (isNewKey && state.tiles.size >= MAX_TILE_ENTRIES) {
                    return state;
                }

                return {
                    tiles: writeTile(state.tiles, sourceKey, next),
                };
            });
        },
        // Eligibility turned off / tile unmount. Mirrors the hook's
        // eligibility-off branch and the unmount `clearFailureTimer` cleanup in
        // `../../StorageThumbnail.tsx`: clear any pending failure timer FIRST so
        // no failure is recorded after abandonment, then return the tile to the
        // inactive baseline (lifecycle `inactive`, readiness `absent`) WITHOUT
        // recording a failure (Requirements 9.1, 9.2, 9.4).
        //
        // Entry-removal decision: the entry is KEPT (not deleted) so the
        // monotonic `attempt` counter survives, matching the hook where
        // `attemptRef` persists across an eligibility interval. Removing the
        // entry would reset `attempt` to 0 on the next read and violate the
        // "attempt non-decreasing while the tile is live" guarantee
        // (Requirement 4.2 / 4.3). The design permits removal, but keeping the
        // entry is the choice taken here for monotonicity.
        //
        // When the key is absent (nothing to clean up, no pending timer) this
        // is a reference-stable no-op: state is returned unchanged so no
        // readiness state is altered and no subscriber re-renders
        // (Requirement 9.5).
        endAttempt: function (sourceKey) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey);
                if (entry === undefined) {
                    return state;
                }

                if (entry.failureTimer !== null) {
                    clearTimeout(entry.failureTimer);
                }

                const next: TileRail = {
                    ...entry,
                    lifecycle: { state: "inactive" },
                    readiness: { state: "absent" },
                    failureTimer: null,
                };

                return {
                    tiles: writeTile(state.tiles, sourceKey, next),
                };
            });
        },

        // TanStack Query `onProgress` bridge. Mirrors the `onProgress`
        // callback in `useThumbnailPreview` (`../../StorageThumbnail.tsx`):
        // only the current, non-terminal attempt may advance, a `frames`
        // report produces a determinate `frames` lifecycle, and any other
        // phase (`encoding`) collapses to the `final-wait` encoding state.
        //
        // The "current, non-terminal attempt only" guard is NOT re-encoded
        // here; it lives in `advanceCurrentAttempt`, which returns the same
        // `entry` reference when `attempt` is stale or the lifecycle is
        // terminal (`ready`/`failed`). Building `next` and routing it through
        // that reducer keeps the single guard authoritative (Requirement 5.5),
        // and the `===` check lets us skip `set` entirely on a no-op so no
        // subscriber re-renders.
        //
        // Beyond the hook, a `frames` payload is validated before use: the
        // server-side `parseProgress` already enforces `total >= 1` and
        // `completed <= total`, but a malformed report is defended against
        // here too (Requirement 5.6). An invalid `frames` payload leaves the
        // lifecycle unchanged (reference-stable no-op); it must not fall
        // through to `final-wait`.
        //
        // Validates Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6.
        reportProgress: function (sourceKey, attempt, progress) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;

                let next: AnimationLifecycle;
                if (progress.phase === "frames") {
                    const { completed, total } = progress;
                    const valid =
                        Number.isInteger(completed) &&
                        Number.isInteger(total) &&
                        total >= 1 &&
                        completed >= 0 &&
                        completed <= total;
                    if (!valid) {
                        // Malformed frames payload: no-op, lifecycle untouched.
                        return state;
                    }
                    next = { state: "frames", attempt, completed, total };
                } else {
                    next = { state: "final-wait", attempt, phase: "encoding" };
                }

                const advanced = advanceCurrentAttempt(entry, attempt, next);
                if (advanced === entry) {
                    // Stale attempt or terminal lifecycle: reference-stable
                    // no-op, skip the write so no subscriber re-renders.
                    return state;
                }

                return {
                    tiles: writeTile(state.tiles, sourceKey, advanced),
                };
            });
        },

        // Animation URL arrived from the TanStack Query result. Mirrors the
        // `animationUrl` effect in `useThumbnailPreview`
        // (`../../StorageThumbnail.tsx`): begin browser-readiness tracking for
        // the current attempt and move the lifecycle into the image-download
        // final wait.
        //
        // Guard: ONLY the attempt is checked here (a NEW url is arriving, so
        // there is no prior url to match against). A stale attempt is a
        // reference-stable no-op that leaves readiness and lifecycle untouched
        // (Requirement 6.2). The lifecycle advance is routed through
        // `advanceCurrentAttempt`, so a terminal (`ready`/`failed`) lifecycle
        // is left unchanged even when the attempt matches.
        //
        // Validates Requirements 6.1, 6.2.
        urlArrived: function (sourceKey, attempt, url) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                if (attempt !== entry.attempt) {
                    // Stale attempt: discard, leaving readiness and lifecycle
                    // unchanged.
                    return state;
                }

                const next: TileRail = advanceCurrentAttempt(entry, attempt, {
                    state: "final-wait",
                    attempt,
                    phase: "image-download",
                });

                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...next,
                        readiness: { state: "loading", attempt, url },
                    }),
                };
            });
        },

        // The animation <img> fired `onLoad`. Mirrors `onAnimationLoad` in
        // `useThumbnailPreview` (`../../StorageThumbnail.tsx`): a non-positive
        // natural dimension is a broken decode (a broken image can still fire
        // `onLoad`); otherwise the url advances into the decode final wait.
        //
        // Guard: the acted-on `attempt`+`url` MUST match the entry's CURRENT
        // readiness attempt+url (mirroring the hook's `current.attempt !==
        // attempt || current.url !== url` checks); any mismatch is a
        // reference-stable no-op (Requirement 6.8).
        //
        // Zero-dimensions path: set `readiness = broken(zero-dimensions)` then
        // DELEGATE the failure to the `failAttempt` store action via
        // `get().failAttempt(...)` so the task 5.1 dismissalToken + timer logic
        // is the single owner of failure (we do NOT inline the failure/timer
        // here). The readiness set and the failAttempt call are two separate
        // `set` transactions (`failAttempt` runs its own `set`), matching the
        // hook's `markBroken(...)` then `enterFailure(...)` ordering.
        //
        // Validates Requirements 6.3, 6.8.
        imageLoaded: function (sourceKey, attempt, url, dims) {
            const entry = get().tiles.get(sourceKey) ?? DEFAULT_TILE;
            const current = entry.readiness;
            if (
                current.state === "absent" ||
                current.attempt !== attempt ||
                current.url !== url
            ) {
                // Stale/superseded load event: discard.
                return;
            }

            if (dims.naturalWidth < 1 || dims.naturalHeight < 1) {
                // A broken decode that still fired onLoad. Record readiness
                // first, then delegate the failure (dismissalToken + timer) to
                // the failAttempt action implemented in task 5.1.
                set(function (state) {
                    const live = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                    return {
                        tiles: writeTile(state.tiles, sourceKey, {
                            ...live,
                            readiness: {
                                state: "broken",
                                attempt,
                                url,
                                reason: "zero-dimensions",
                            },
                        }),
                    };
                });
                get().failAttempt(sourceKey, attempt, "zero-dimensions");
                return;
            }

            // Positive dimensions: advance to decoding + the image-decode
            // final wait (lifecycle advance respects the terminal/stale guard).
            set(function (state) {
                const live = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                const next: TileRail = advanceCurrentAttempt(live, attempt, {
                    state: "final-wait",
                    attempt,
                    phase: "image-decode",
                });
                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...next,
                        readiness: { state: "decoding", attempt, url },
                    }),
                };
            });
        },

        // A successful `img.decode()` for the current attempt+url. Mirrors
        // `markReady` in `useThumbnailPreview` (`../../StorageThumbnail.tsx`):
        // readiness becomes `ready` and, unless the lifecycle already failed,
        // the lifecycle becomes `ready(url)`.
        //
        // Guard: the acted-on `attempt`+`url` MUST match the entry's CURRENT
        // readiness attempt+url; any mismatch is a reference-stable no-op.
        //
        // `ready` is itself a terminal lifecycle state, so the lifecycle must
        // be advanced to `ready` ONLY from a non-terminal state — which is
        // exactly what `advanceCurrentAttempt` enforces (it refuses to advance
        // a terminal `ready`/`failed`). This leaves an already-`failed`
        // lifecycle as `failed` while still marking readiness `ready`.
        //
        // Validates Requirements 6.5, 6.6.
        imageDecoded: function (sourceKey, attempt, url) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                const current = entry.readiness;
                if (
                    current.state === "absent" ||
                    current.attempt !== attempt ||
                    current.url !== url
                ) {
                    // Stale/superseded decode: discard.
                    return state;
                }

                // Advancing to `ready` is a no-op on a terminal lifecycle, so a
                // `failed` lifecycle is preserved; a non-terminal lifecycle
                // becomes `ready(url)`.
                const next: TileRail = advanceCurrentAttempt(entry, attempt, {
                    state: "ready",
                    attempt,
                    url,
                });

                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...next,
                        readiness: { state: "ready", attempt, url },
                    }),
                };
            });
        },

        // The animation image failed to load or decode. Mirrors `markBroken`
        // in `useThumbnailPreview` (`../../StorageThumbnail.tsx`): it is
        // readiness-ONLY. The hook's `onAnimationError` / decode-reject paths
        // call `markBroken(...)` THEN `enterFailure(...)` separately, and task 8
        // wires the hook to call `failAttempt` separately for load/decode
        // errors — so `imageBroken` MUST NOT call `failAttempt` itself.
        //
        // Guard: the acted-on `attempt`+`url` MUST match the entry's CURRENT
        // readiness attempt+url; any mismatch is a reference-stable no-op.
        //
        // Validates Requirements 6.4, 6.7.
        imageBroken: function (sourceKey, attempt, url, reason) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                const current = entry.readiness;
                if (
                    current.state === "absent" ||
                    current.attempt !== attempt ||
                    current.url !== url
                ) {
                    // Stale/superseded error: discard.
                    return state;
                }

                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...entry,
                        readiness: { state: "broken", attempt, url, reason },
                    }),
                };
            });
        },

        // Fail the current attempt and own the single FAILURE_VISIBLE_MS
        // auto-dismiss timer. Mirrors `enterFailure` in `useThumbnailPreview`
        // (`../../StorageThumbnail.tsx`): compute the dismissal token outside
        // the updater, set lifecycle `failed` only for the current attempt that
        // is not already failed, clear the prior timer, schedule a fresh
        // setTimeout(FAILURE_VISIBLE_MS), and have the timer transition to
        // `inactive` ONLY when the entry is still `failed` with the same
        // attempt+token that scheduled it.
        //
        // Guard-first ordering (mirrors `imageLoaded`): the attempt / already-
        // failed guard is applied against the LIVE entry via `get()` BEFORE a
        // timer is ever scheduled, so a stale or duplicate failure never
        // schedules a timer and never increments the token (Requirements 8.6,
        // and the "already failed" guard in 8.1). Only after the guard passes
        // do we clear the prior timer, schedule the new one to capture its
        // handle, and `set` the failed entry carrying that handle — keeping AT
        // MOST ONE non-null failureTimer live per entry (Requirement 8.2).
        //
        // Validates Requirements 8.1, 8.2, 8.3, 8.4, 8.6, 9.1.
        failAttempt: function (sourceKey, attempt, reason) {
            const entry = get().tiles.get(sourceKey) ?? DEFAULT_TILE;

            // No-op for a stale attempt or an entry that is already failed:
            // leave lifecycle, dismissalToken, and failureTimer untouched and
            // schedule nothing.
            if (
                attempt !== entry.attempt ||
                entry.lifecycle.state === "failed"
            ) {
                return;
            }

            // Compute the new token outside any updater so the identity the
            // timer captures is fixed before scheduling (the hook does the same
            // with dismissalTokenRef). Clearing the prior timer here guarantees
            // only one live timer per entry even though we re-read the entry
            // inside `set` below.
            const newToken = entry.dismissalToken + 1;
            if (entry.failureTimer !== null) {
                clearTimeout(entry.failureTimer);
            }

            // Schedule first to capture the handle, then store it on the entry.
            // The callback re-reads the LIVE entry via the `set` state param
            // (never a stale closure) and only dismisses when the entry is
            // still `failed` with the SAME attempt and token; in every fire
            // case it sets failureTimer back to null.
            const timer = setTimeout(function () {
                set(function (state) {
                    const live = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                    if (
                        live.lifecycle.state === "failed" &&
                        live.lifecycle.attempt === attempt &&
                        live.lifecycle.dismissalToken === newToken
                    ) {
                        // Still the same failure that scheduled this timer:
                        // auto-dismiss to inactive (Requirement 8.3).
                        return {
                            tiles: writeTile(state.tiles, sourceKey, {
                                ...live,
                                lifecycle: { state: "inactive" },
                                failureTimer: null,
                            }),
                        };
                    }
                    // Superseded by a newer attempt/failure or already changed:
                    // leave lifecycle and dismissalToken unchanged, only null
                    // the handle (Requirement 8.4).
                    return {
                        tiles: writeTile(state.tiles, sourceKey, {
                            ...live,
                            failureTimer: null,
                        }),
                    };
                });
            }, FAILURE_VISIBLE_MS);

            set(function (state) {
                const live = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...live,
                        lifecycle: {
                            state: "failed",
                            attempt,
                            reason,
                            dismissalToken: newToken,
                        },
                        dismissalToken: newToken,
                        failureTimer: timer,
                    }),
                };
            });
        },

        // Poster slice transitions (idle/loading/ready/broken), keyed on the
        // rendered poster `url`. These mirror, action-for-action, the poster
        // behavior that currently lives in `useThumbnailPreview`
        // (`../../StorageThumbnail.tsx`): the posterUrl-change reset effect
        // (`posterReset`), the `onPosterLoad` handler (`posterLoaded`), and the
        // `onPosterError` handler (`posterBroken`). Each only rewrites the
        // `poster` field of the entry via `writeTile` and leaves
        // lifecycle/readiness/attempt/dismissalToken/failureTimer untouched.
        // Validates Requirement 3.5.

        // Mirrors the posterUrl-change reset effect. `url === undefined` →
        // idle. Otherwise enter `loading` for the new url, but when the current
        // poster already targets the same url leave the entry untouched by
        // identity (reference-stable no-op) so a subscribed selector does not
        // re-render.
        posterReset: function (sourceKey, url) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                if (url === undefined) {
                    if (entry.poster.state === "idle") {
                        return state;
                    }
                    return {
                        tiles: writeTile(state.tiles, sourceKey, {
                            ...entry,
                            poster: { state: "idle" },
                        }),
                    };
                }
                if ("url" in entry.poster && entry.poster.url === url) {
                    return state;
                }
                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...entry,
                        poster: { state: "loading", url },
                    }),
                };
            });
        },

        // Mirrors `onPosterLoad`. A non-positive natural width is a broken
        // decode (a broken image can still fire `onLoad`), so poster → broken.
        // Otherwise poster → ready, UNLESS the current poster already targets a
        // DIFFERENT url, in which case this load belongs to a stale url and is
        // ignored (reference-stable no-op) — matching the original guard that
        // keeps `current` when `current.url !== posterUrl`.
        posterLoaded: function (sourceKey, url, naturalWidth) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                if (naturalWidth < 1) {
                    return {
                        tiles: writeTile(state.tiles, sourceKey, {
                            ...entry,
                            poster: { state: "broken", url },
                        }),
                    };
                }
                if ("url" in entry.poster && entry.poster.url !== url) {
                    return state;
                }
                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...entry,
                        poster: { state: "ready", url },
                    }),
                };
            });
        },

        // Mirrors `onPosterError`: an image error for the rendered poster url is
        // always terminal-broken for that url.
        posterBroken: function (sourceKey, url) {
            set(function (state) {
                const entry = state.tiles.get(sourceKey) ?? DEFAULT_TILE;
                return {
                    tiles: writeTile(state.tiles, sourceKey, {
                        ...entry,
                        poster: { state: "broken", url },
                    }),
                };
            });
        },
    };
});
