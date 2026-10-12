import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { useHover } from "react-aria/useHover";
import { useFocus } from "react-aria/useFocus";
import { useLongPress } from "react-aria/useLongPress";
import { mergeProps } from "react-aria/mergeProps";
import { FileIcon } from "lucide-react";
import { cy } from "@/utils/cy";
import type { JobProgress } from "@/server/requestJob";
import createThumbnailGetQueryOptions, {
    thumbnailKind,
} from "../queryOptions/createThumbnailGet.ts";

// A monotonically increasing attempt identifier scoped to one mounted tile.
// Every eligibility interval gets a fresh id so results, image events, decode
// promises, and failure timers from a superseded attempt can be ignored.
type AnimationAttemptId = number;

// Why a failure happened. Only used to pick an accessible status; the visible
// rail is identical for every reason. Cancellation is never a failure.
type AnimationFailureReason =
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
type AnimationLifecycle =
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
type AnimationUrlReadiness =
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
type PosterLoadState =
    | { readonly state: "idle" }
    | { readonly state: "loading"; readonly url: string }
    | { readonly state: "ready"; readonly url: string }
    | { readonly state: "broken"; readonly url: string };

// A failure rail is held for this long and then dismissed by timer. The timer
// is authoritative because reduced-motion removes the shake animation, so an
// `animationend` event may never fire.
const FAILURE_VISIBLE_MS = 1000;

interface StorageThumbnailProps {
    fileName: string;
    sourceKey: string;
    // Whether this tile is the grid's single latest-active preview. Undefined
    // when the grid has no coordinator (e.g. isolated usage); treated as the
    // legacy self-managed behaviour would never activate without it, so the
    // coordinator always supplies it in tile view.
    isActive?: boolean;
    onActiveChange?: (sourceKey: string, active: boolean) => void;
}

export function StorageThumbnail({
    fileName,
    sourceKey,
    isActive = false,
    onActiveChange,
}: StorageThumbnailProps): React.ReactNode {
    const preview = useThumbnailPreview(
        fileName,
        sourceKey,
        isActive,
        onActiveChange,
    );

    return (
        <div
            {...cy("dStorage_thumbnail")}
            {...preview.activity.surfaceProps}
            ref={preview.ref}
            tabIndex={preview.isVideo ? 0 : undefined}
            role={preview.isVideo ? "button" : undefined}
            aria-label={preview.isVideo ? `Preview ${fileName}` : undefined}
            className="dStorage-thumbnail-surface relative aspect-[8/5] w-full overflow-hidden rounded-md bg-drac-selection outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-drac-purple"
        >
            {/* Poster/fallback layer: the permanent visual baseline. */}
            <div aria-hidden className="absolute inset-0 h-full w-full">
                {preview.poster ? (
                    <img
                        {...cy(preview.poster.selector)}
                        alt=""
                        src={preview.poster.url}
                        width={512}
                        height={320}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        onLoad={preview.poster.onLoad}
                        onError={preview.poster.onError}
                    />
                ) : (
                    <ThumbnailFallback
                        fileName={fileName}
                        isLoading={preview.isLoading}
                    />
                )}
            </div>
            {/* Animation layer: stacked above the poster, hidden until the
                current animation URL has genuinely loaded and decoded. */}
            {preview.animation ? (
                <div
                    aria-hidden
                    className="absolute inset-0 h-full w-full"
                    style={{
                        visibility: preview.animation.revealed
                            ? "visible"
                            : "hidden",
                    }}
                >
                    <img
                        {...cy("dStorage_thumbnail_animation")}
                        alt=""
                        src={preview.animation.url}
                        width={512}
                        height={320}
                        loading="eager"
                        decoding="async"
                        className="h-full w-full object-cover"
                        onLoad={preview.animation.onLoad}
                        onError={preview.animation.onError}
                    />
                </div>
            ) : null}
            {preview.rail ? (
                <ThumbnailProgressRail
                    fileName={fileName}
                    rail={preview.rail}
                />
            ) : null}
        </div>
    );
}

// The visual/accessible description of the top rail, derived from the
// lifecycle. `inactive` and `ready` produce no rail at all.
type RailView =
    | { readonly kind: "indeterminate"; readonly label: string }
    | {
          readonly kind: "frames";
          readonly completed: number;
          readonly total: number;
      }
    | { readonly kind: "failed" };

function railView(
    lifecycle: AnimationLifecycle,
    fileName: string,
): RailView | null {
    switch (lifecycle.state) {
        case "inactive":
        case "ready":
            return null;
        case "initial-wait":
            return {
                kind: "indeterminate",
                label: `Preparing animated preview for ${fileName}`,
            };
        case "frames":
            return {
                kind: "frames",
                completed: lifecycle.completed,
                total: lifecycle.total,
            };
        case "final-wait": {
            const activity =
                lifecycle.phase === "encoding"
                    ? "Encoding"
                    : lifecycle.phase === "image-download"
                      ? "Loading"
                      : "Preparing";
            return {
                kind: "indeterminate",
                label: `${activity} animated preview for ${fileName}`,
            };
        }
        case "failed":
            return { kind: "failed" };
    }
}

function useThumbnailPreview(
    fileName: string,
    sourceKey: string,
    isActive: boolean,
    onActiveChange: ((sourceKey: string, active: boolean) => void) | undefined,
) {
    const kind = thumbnailKind(fileName);
    const isVideo = kind === "video";
    const { ref: visibilityRef, isVisible } = useBecameVisible();
    const [poster, setPoster] = useState<PosterLoadState>({ state: "idle" });

    // Attempt ownership. The ref is the authoritative current attempt id; the
    // lifecycle/readiness state mirror it. A new attempt is minted only when
    // eligibility turns on.
    const attemptRef = useRef<AnimationAttemptId>(0);
    const [lifecycle, setLifecycle] = useState<AnimationLifecycle>({
        state: "inactive",
    });
    const [readiness, setReadiness] = useState<AnimationUrlReadiness>({
        state: "absent",
    });
    const dismissalTokenRef = useRef(0);
    const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const posterQuery = useQuery({
        ...createThumbnailGetQueryOptions(sourceKey, kind ?? "image"),
        enabled: kind !== undefined && isVisible,
    });

    const posterUrl = posterQuery.data?.url;

    // Reset readiness whenever the rendered poster URL changes. A load/error
    // event is only trusted when it belongs to the URL we are showing now.
    useEffect(
        function () {
            if (posterUrl === undefined) {
                setPoster({ state: "idle" });
                return;
            }
            setPoster(function (current) {
                if ("url" in current && current.url === posterUrl) {
                    return current;
                }
                return { state: "loading", url: posterUrl };
            });
        },
        [posterUrl],
    );

    const posterReady =
        poster.state === "ready" &&
        posterUrl !== undefined &&
        poster.url === posterUrl;

    const animationEnabled = isVideo && isVisible && isActive && posterReady;

    const clearFailureTimer = useCallback(function () {
        if (failureTimerRef.current !== null) {
            clearTimeout(failureTimerRef.current);
            failureTimerRef.current = null;
        }
    }, []);

    // Mint a new attempt and reset lifecycle/readiness on the eligibility
    // edge. A monotonic attempt id must survive re-renders within one
    // eligibility interval, and minting it plus scheduling the animation query
    // is a genuine side effect, so this is an effect keyed on the derived
    // eligibility boolean. When eligibility turns off (leave / supersession /
    // gating / poster not ready) the tile returns straight to the inactive
    // baseline; cancellation is never a failure.
    useEffect(
        function () {
            clearFailureTimer();
            if (animationEnabled) {
                attemptRef.current += 1;
                setLifecycle({
                    state: "initial-wait",
                    attempt: attemptRef.current,
                });
                setReadiness({ state: "absent" });
            } else {
                setLifecycle({ state: "inactive" });
                setReadiness({ state: "absent" });
            }
        },
        [animationEnabled, clearFailureTimer],
    );

    // Clear any pending failure timer on unmount.
    useEffect(
        function () {
            return clearFailureTimer;
        },
        [clearFailureTimer],
    );

    // Progress callbacks are closed over the attempt that created the query so
    // a late callback from a superseded attempt is a no-op.
    const onProgress = useCallback(function (value: JobProgress) {
        const attempt = attemptRef.current;
        setLifecycle(function (current) {
            // Only the current attempt may advance, and only out of waiting
            // states (never regress from ready/failed).
            if (!("attempt" in current) || current.attempt !== attempt) {
                return current;
            }
            if (current.state === "ready" || current.state === "failed") {
                return current;
            }
            if (value.phase === "frames") {
                return {
                    state: "frames",
                    attempt,
                    completed: value.completed,
                    total: value.total,
                };
            }
            return { state: "final-wait", attempt, phase: "encoding" };
        });
    }, []);

    const animation = useQuery({
        ...createThumbnailGetQueryOptions(sourceKey, "animation", onProgress),
        enabled: animationEnabled,
    });

    const animationUrl = animation.data?.url;
    const animationError = animation.isError;

    // When the query produces a URL, move into the final wait (image download)
    // and start browser readiness tracking for the current attempt.
    useEffect(
        function () {
            if (!animationEnabled || animationUrl === undefined) {
                return;
            }
            const attempt = attemptRef.current;
            setReadiness(function (current) {
                if (
                    current.state !== "absent" &&
                    current.attempt === attempt &&
                    current.url === animationUrl
                ) {
                    return current;
                }
                return { state: "loading", attempt, url: animationUrl };
            });
            setLifecycle(function (current) {
                if (!("attempt" in current) || current.attempt !== attempt) {
                    return current;
                }
                if (current.state === "ready" || current.state === "failed") {
                    return current;
                }
                return {
                    state: "final-wait",
                    attempt,
                    phase: "image-download",
                };
            });
        },
        [animationEnabled, animationUrl],
    );

    const enterFailure = useCallback(
        function (attempt: AnimationAttemptId, reason: AnimationFailureReason) {
            // Compute the dismissal token outside the updater so the updater
            // stays pure (React may invoke it more than once).
            dismissalTokenRef.current += 1;
            const token = dismissalTokenRef.current;
            setLifecycle(function (current) {
                if (!("attempt" in current) || current.attempt !== attempt) {
                    return current;
                }
                if (current.state === "failed") {
                    return current;
                }
                return {
                    state: "failed",
                    attempt,
                    reason,
                    dismissalToken: token,
                };
            });
            clearFailureTimer();
            failureTimerRef.current = setTimeout(function () {
                failureTimerRef.current = null;
                setLifecycle(function (current) {
                    if (
                        current.state === "failed" &&
                        current.attempt === attempt &&
                        current.dismissalToken === token
                    ) {
                        return { state: "inactive" };
                    }
                    return current;
                });
            }, FAILURE_VISIBLE_MS);
        },
        [clearFailureTimer],
    );

    // A rejected animation query (request/server/timeout/malformed) fails the
    // current attempt. Cancellation does not set isError, so this path is only
    // reached by genuine failure.
    useEffect(
        function () {
            if (!animationEnabled || !animationError) {
                return;
            }
            enterFailure(attemptRef.current, "server");
        },
        [animationEnabled, animationError, enterFailure],
    );

    // --- Animation image browser-readiness handlers (attempt + URL scoped) ---

    const markReady = useCallback(function (
        attempt: AnimationAttemptId,
        url: string,
    ) {
        setReadiness(function (current) {
            if (
                current.state === "absent" ||
                current.attempt !== attempt ||
                current.url !== url
            ) {
                return current;
            }
            return { state: "ready", attempt, url };
        });
        setLifecycle(function (current) {
            if (!("attempt" in current) || current.attempt !== attempt) {
                return current;
            }
            if (current.state === "failed") {
                return current;
            }
            return { state: "ready", attempt, url };
        });
    }, []);

    const markBroken = useCallback(function (
        attempt: AnimationAttemptId,
        url: string,
        reason: "image-load" | "image-decode" | "zero-dimensions",
    ) {
        setReadiness(function (current) {
            if (
                current.state === "absent" ||
                current.attempt !== attempt ||
                current.url !== url
            ) {
                return current;
            }
            return { state: "broken", attempt, url, reason };
        });
    }, []);

    const onAnimationLoad = useCallback(
        function (event: React.SyntheticEvent<HTMLImageElement>) {
            const attempt = attemptRef.current;
            if (animationUrl === undefined) {
                return;
            }
            const img = event.currentTarget;
            if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
                markBroken(attempt, animationUrl, "zero-dimensions");
                enterFailure(attempt, "zero-dimensions");
                return;
            }
            setLifecycle(function (current) {
                if (!("attempt" in current) || current.attempt !== attempt) {
                    return current;
                }
                if (current.state === "ready" || current.state === "failed") {
                    return current;
                }
                return { state: "final-wait", attempt, phase: "image-decode" };
            });
            // Prefer a genuine decode; fall back to positive-dimension success
            // when decode is unavailable.
            if (typeof img.decode === "function") {
                setReadiness(function (current) {
                    if (
                        current.state === "absent" ||
                        current.attempt !== attempt ||
                        current.url !== animationUrl
                    ) {
                        return current;
                    }
                    return { state: "decoding", attempt, url: animationUrl };
                });
                img.decode().then(
                    function () {
                        markReady(attempt, animationUrl);
                    },
                    function () {
                        markBroken(attempt, animationUrl, "image-decode");
                        enterFailure(attempt, "image-decode");
                    },
                );
            } else {
                markReady(attempt, animationUrl);
            }
        },
        [animationUrl, enterFailure, markReady, markBroken],
    );

    const onAnimationError = useCallback(
        function () {
            const attempt = attemptRef.current;
            if (animationUrl === undefined) {
                return;
            }
            markBroken(attempt, animationUrl, "image-load");
            enterFailure(attempt, "image-load");
        },
        [animationUrl, markBroken, enterFailure],
    );

    const ref = visibilityRef;
    const activity = usePreviewActivity(sourceKey, isVideo, onActiveChange);

    // The animation layer is only revealed when readiness is verified for the
    // current attempt and URL.
    const animationRevealed =
        readiness.state === "ready" &&
        animationUrl !== undefined &&
        readiness.url === animationUrl &&
        readiness.attempt === attemptRef.current &&
        lifecycle.state === "ready";

    const poster_ = displayedPoster({
        kind,
        posterState: poster,
        posterUrl,
        posterFailed: posterQuery.isError,
        posterLoading: posterQuery.fetchStatus === "fetching",
        isVisible,
        onPosterLoad: function (event: React.SyntheticEvent<HTMLImageElement>) {
            if (posterUrl === undefined) {
                return;
            }
            const loaded = event.currentTarget;
            if (loaded.naturalWidth <= 0) {
                setPoster({ state: "broken", url: posterUrl });
                return;
            }
            setPoster(function (current) {
                if ("url" in current && current.url !== posterUrl) {
                    return current;
                }
                return { state: "ready", url: posterUrl };
            });
        },
        onPosterError: function () {
            if (posterUrl === undefined) {
                return;
            }
            setPoster({ state: "broken", url: posterUrl });
        },
    });

    // The animation node is rendered (hidden) as soon as a URL exists for the
    // current active attempt, so the browser can download and decode it while
    // the poster stays visible.
    const animationFrame =
        animationEnabled && animationUrl !== undefined
            ? {
                  url: animationUrl,
                  revealed: animationRevealed,
                  onLoad: onAnimationLoad,
                  onError: onAnimationError,
              }
            : undefined;

    return {
        ref,
        activity,
        isVideo,
        poster: poster_.frame,
        isLoading: poster_.isLoading,
        animation: animationFrame,
        rail: railView(lifecycle, fileName),
    };
}

function ThumbnailProgressRail({
    fileName,
    rail,
}: {
    fileName: string;
    rail: RailView;
}): React.ReactNode {
    if (rail.kind === "failed") {
        return (
            <div
                {...cy("dStorage_thumbnail_progress")}
                data-rail-state="failed"
                role="status"
                aria-label={`Animated preview failed for ${fileName}`}
                className="thumbnail-preview-rail thumbnail-preview-rail--failed"
            >
                <div className="thumbnail-preview-rail__fill thumbnail-preview-rail__fill--failed" />
            </div>
        );
    }

    if (rail.kind === "frames") {
        return (
            <ProgressBar
                {...cy("dStorage_thumbnail_progress")}
                data-rail-state="frames"
                value={rail.completed}
                minValue={0}
                maxValue={rail.total}
                aria-label={`Generating animated preview for ${fileName}`}
                valueLabel={`${rail.completed} of ${rail.total} frames`}
                className="thumbnail-preview-rail"
            >
                {function ({ percentage }) {
                    const width =
                        typeof percentage === "number" ? percentage : 0;
                    return (
                        <div
                            className="thumbnail-preview-rail__fill thumbnail-preview-rail__fill--determinate"
                            style={{ width: `${width}%` }}
                        />
                    );
                }}
            </ProgressBar>
        );
    }

    // Indeterminate (initial-wait / final-wait).
    return (
        <ProgressBar
            {...cy("dStorage_thumbnail_progress")}
            data-rail-state="indeterminate"
            isIndeterminate
            aria-label={rail.label}
            className="thumbnail-preview-rail"
        >
            <div className="thumbnail-preview-rail__fill thumbnail-preview-rail__fill--indeterminate" />
        </ProgressBar>
    );
}

function displayedPoster(input: {
    kind: ReturnType<typeof thumbnailKind>;
    posterState: PosterLoadState;
    posterUrl: string | undefined;
    posterFailed: boolean;
    posterLoading: boolean;
    isVisible: boolean;
    onPosterLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
    onPosterError: () => void;
}): {
    frame:
        | {
              url: string;
              selector: string;
              onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
              onError: () => void;
          }
        | undefined;
    isLoading: boolean;
} {
    const posterBroken = input.posterState.state === "broken";
    if (
        input.kind !== undefined &&
        !input.posterFailed &&
        !posterBroken &&
        input.posterUrl
    ) {
        return {
            frame: {
                url: input.posterUrl,
                selector: "dStorage_thumbnail_image",
                onLoad: input.onPosterLoad,
                onError: input.onPosterError,
            },
            isLoading: false,
        };
    }
    return {
        frame: undefined,
        isLoading:
            input.kind !== undefined && input.isVisible && input.posterLoading,
    };
}

function ThumbnailFallback({
    fileName,
    isLoading,
}: {
    fileName: string;
    isLoading: boolean;
}): React.ReactNode {
    return (
        <div
            {...cy(
                isLoading
                    ? "dStorage_thumbnail_loading"
                    : "dStorage_thumbnail_fallback",
            )}
            className="flex h-full w-full flex-col items-center justify-center gap-1 text-drac-comment"
        >
            <FileIcon aria-hidden className="h-6 w-6" />
            <span className="font-sans text-xs tracking-wide">
                {isLoading ? "Loading" : extensionLabel(fileName)}
            </span>
        </div>
    );
}

function extensionLabel(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0 || dot === fileName.length - 1) {
        return "FILE";
    }
    return fileName.slice(dot + 1, dot + 5).toUpperCase();
}

function useBecameVisible(): {
    ref: (node: HTMLDivElement | null) => void;
    isVisible: boolean;
} {
    const [isVisible, setVisible] = useState(false);
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const ref = useCallback(
        function (node: HTMLDivElement | null) {
            nodeRef.current = node;
            observerRef.current?.disconnect();
            observerRef.current = null;
            if (!node || isVisible) {
                return;
            }
            if (typeof IntersectionObserver === "undefined") {
                setVisible(true);
                return;
            }
            const observer = new IntersectionObserver(
                function (entries) {
                    if (
                        entries.some(function (entry) {
                            return entry.isIntersecting;
                        })
                    ) {
                        setVisible(true);
                        observer.disconnect();
                    }
                },
                { rootMargin: "160px" },
            );
            observer.observe(node);
            observerRef.current = observer;
        },
        [isVisible],
    );
    return { ref, isVisible };
}

// Reports combined local preview activity (mouse hover, keyboard focus, or a
// completed-and-still-held touch long press) to the grid coordinator.
//
// Each modality is tracked independently so one modality ending does not
// deactivate another that remains active. React Aria's `useHover` ignores the
// emulated mouse events a browser synthesises after touch, so a released touch
// preview cannot be reopened by a compatibility mouse event. `useFocus`
// supplies the keyboard alternative required alongside long press, and
// `useLongPress` is restricted to touch with the default 500 ms threshold so
// mouse/pen holds never activate.
//
// A completed long press records a gesture id; its terminating click/pointerup
// is consumed once as a defensive boundary so a completed hold does not select
// the enclosing grid row. Short taps and canceled pending holds are untouched.
function usePreviewActivity(
    sourceKey: string,
    isVideo: boolean,
    onActiveChange: ((sourceKey: string, active: boolean) => void) | undefined,
): {
    surfaceProps: React.HTMLAttributes<HTMLDivElement>;
} {
    const onChangeRef = useRef(onActiveChange);
    useEffect(
        function () {
            onChangeRef.current = onActiveChange;
        },
        [onActiveChange],
    );

    const hovered = useRef(false);
    const focused = useRef(false);
    const touchHeld = useRef(false);
    // True while a completed long press is active; its release must suppress
    // the row-selection click exactly once.
    const suppressNextClick = useRef(false);

    const emit = useCallback(
        function () {
            onChangeRef.current?.(
                sourceKey,
                hovered.current || focused.current || touchHeld.current,
            );
        },
        [sourceKey],
    );

    // On unmount/detach report inactive so the coordinator drops this
    // candidate and cancels any obsolete client work.
    useEffect(
        function () {
            return function () {
                if (hovered.current || focused.current || touchHeld.current) {
                    hovered.current = false;
                    focused.current = false;
                    touchHeld.current = false;
                    onChangeRef.current?.(sourceKey, false);
                }
            };
        },
        [sourceKey],
    );

    const { hoverProps } = useHover({
        isDisabled: !isVideo,
        onHoverChange: function (isHovering) {
            hovered.current = isHovering;
            emit();
        },
    });

    const { focusProps } = useFocus({
        isDisabled: !isVideo,
        onFocusChange: function (isFocused) {
            focused.current = isFocused;
            emit();
        },
    });

    const { longPressProps } = useLongPress({
        isDisabled: !isVideo,
        // Touch-only: mouse and pen holds must not activate a preview.
        pointerType: "touch",
        threshold: 500,
        accessibilityDescription: "Press and hold to preview this video",
        onLongPress: function () {
            touchHeld.current = true;
            suppressNextClick.current = true;
            emit();
        },
        onLongPressEnd: function () {
            // Fires on release/cancel of a hold that reached the threshold.
            if (touchHeld.current) {
                touchHeld.current = false;
                emit();
            }
        },
    });

    // Defensive row-selection boundary: consume the single click produced by a
    // completed long press. Short taps never set the flag, so their selection
    // behaviour is preserved.
    const onClickCapture = useCallback(function (
        event: React.MouseEvent<HTMLDivElement>,
    ) {
        if (suppressNextClick.current) {
            suppressNextClick.current = false;
            event.stopPropagation();
            event.preventDefault();
        }
    }, []);

    const surfaceProps = isVideo
        ? mergeProps<React.HTMLAttributes<HTMLDivElement>[]>(
              hoverProps,
              focusProps,
              longPressProps,
              { onClickCapture },
          )
        : {};

    return { surfaceProps };
}
