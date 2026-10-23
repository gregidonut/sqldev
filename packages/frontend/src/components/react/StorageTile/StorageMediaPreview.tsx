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
    dStorageThumbnailQueryKey,
    thumbnailKind,
    thumbnailResourceKey,
    type ThumbnailResource,
} from "./createThumbnailGet.ts";
import {
    useThumbnailRailStore,
    type AnimationLifecycle,
    type PosterLoadState,
} from "./thumbnailRailStore.ts";
import { useOptionalPreviewCoordinator } from "./PreviewCoordinator.tsx";

// The lifecycle/readiness/poster unions, the attempt/failure-reason types, the
// `FAILURE_VISIBLE_MS` constant, the attempt/dismissal-token counters, and the
// failure timer live in the per-instance Zustand store
// (`./thumbnailRailStore.ts`). This component consumes that store and bridges
// React/TanStack Query/DOM events into store actions.

interface StorageMediaPreviewProps {
    fileName: string;
    instanceKey: string;
    resource: ThumbnailResource;
    userId: string;
    // Whether this tile is the group's single latest-active preview. Undefined
    // uses the surrounding coordinator when one is mounted.
    isActive?: boolean;
    onActiveChange?: (instanceKey: string, active: boolean) => void;
    registerAnimation?: (
        instanceKey: string,
        queryKey: readonly unknown[] | null,
    ) => void;
}

export function StorageMediaPreview({
    fileName,
    instanceKey,
    resource,
    userId,
    isActive,
    onActiveChange,
    registerAnimation,
}: StorageMediaPreviewProps): React.ReactNode {
    const coordinator = useOptionalPreviewCoordinator();
    const active = isActive ?? coordinator?.activeInstanceKey === instanceKey;
    const change = onActiveChange ?? coordinator?.onActiveChange;
    const register = registerAnimation ?? coordinator?.registerAnimation;
    const preview = useThumbnailPreview(
        fileName,
        instanceKey,
        resource,
        userId,
        active,
        change,
        register,
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
                        className="m-0 block h-full w-full object-cover"
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
                        className="m-0 block h-full w-full object-cover"
                        ref={preview.animation.onRef}
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
    instanceKey: string,
    resource: ThumbnailResource,
    userId: string,
    isActive: boolean,
    onActiveChange: ((instanceKey: string, active: boolean) => void) | undefined,
    registerAnimation:
        | ((instanceKey: string, queryKey: readonly unknown[] | null) => void)
        | undefined,
) {
    const kind = thumbnailKind(fileName);
    const isVideo = kind === "video";
    const { ref: visibilityRef, isVisible } = useBecameVisible();

    // All rail/poster lifecycle state now lives in the per-tile store, keyed by
    // instanceKey. Subscribe to this tile's entry and select the actions we need.
    // Actions are selected individually to keep each reference stable.
    const tile = useThumbnailRailStore((s) => s.getTile(instanceKey));
    const beginAttempt = useThumbnailRailStore((s) => s.beginAttempt);
    const endAttempt = useThumbnailRailStore((s) => s.endAttempt);
    const reportProgress = useThumbnailRailStore((s) => s.reportProgress);
    const urlArrived = useThumbnailRailStore((s) => s.urlArrived);
    const imageLoaded = useThumbnailRailStore((s) => s.imageLoaded);
    const imageDecoded = useThumbnailRailStore((s) => s.imageDecoded);
    const imageBroken = useThumbnailRailStore((s) => s.imageBroken);
    const failAttempt = useThumbnailRailStore((s) => s.failAttempt);
    const posterReset = useThumbnailRailStore((s) => s.posterReset);
    const posterLoaded = useThumbnailRailStore((s) => s.posterLoaded);
    const posterBroken = useThumbnailRailStore((s) => s.posterBroken);

    const posterQuery = useQuery({
        ...createThumbnailGetQueryOptions(
            resource,
            userId,
            kind ?? "image",
        ),
        enabled: kind !== undefined && isVisible,
    });

    const posterUrl = posterQuery.data?.url;

    // Reset poster readiness whenever the rendered poster URL changes. A
    // load/error event is only trusted when it belongs to the URL we are
    // showing now. The store's `posterReset` is a reference-stable no-op when
    // the poster already targets this URL.
    useEffect(
        function () {
            posterReset(instanceKey, posterUrl);
        },
        [posterReset, instanceKey, posterUrl],
    );

    const poster = tile.poster;
    const posterReady =
        poster.state === "ready" &&
        posterUrl !== undefined &&
        poster.url === posterUrl;

    const animationEnabled = isVideo && isVisible && isActive && posterReady;

    // Mint a new attempt on the eligibility edge and reset to the inactive
    // baseline when eligibility turns off; the cleanup also runs `endAttempt`
    // on unmount, which clears any pending failure timer. The store owns the
    // monotonic attempt id, so this effect only signals the transition.
    useEffect(
        function () {
            if (animationEnabled) {
                beginAttempt(instanceKey);
            } else {
                endAttempt(instanceKey);
            }
            return function () {
                endAttempt(instanceKey);
            };
        },
        [animationEnabled, instanceKey, beginAttempt, endAttempt],
    );

    // Progress bridge: reference-stable so the query options stay stable. The
    // current attempt is read from the live store entry at call time (never a
    // stale closure); the store action also guards on attempt internally.
    const onProgress = useCallback(
        function (value: JobProgress) {
            const attempt = useThumbnailRailStore
                .getState()
                .getTile(instanceKey).attempt;
            reportProgress(instanceKey, attempt, value);
        },
        [reportProgress, instanceKey],
    );

    const animation = useQuery({
        ...createThumbnailGetQueryOptions(
            resource,
            userId,
            "animation",
            onProgress,
        ),
        enabled: animationEnabled,
    });

    const animationUrl = animation.data?.url;
    const animationError = animation.isError;

    // When the query produces a URL, hand it to the store, which starts browser
    // readiness tracking and moves the lifecycle into the image-download final
    // wait for the current attempt.
    useEffect(
        function () {
            if (!animationEnabled || animationUrl === undefined) {
                return;
            }
            const tileNow = useThumbnailRailStore.getState().getTile(instanceKey);
            const readiness = tileNow.readiness;
            if (
                readiness.state !== "absent" &&
                readiness.attempt === tileNow.attempt &&
                readiness.url === animationUrl
            ) {
                return;
            }
            urlArrived(instanceKey, tileNow.attempt, animationUrl);
        },
        [animationEnabled, animationUrl, instanceKey, urlArrived],
    );

    // A rejected animation query (request/server/timeout/malformed) fails the
    // current attempt. Cancellation does not set isError, so this path is only
    // reached by genuine failure.
    useEffect(
        function () {
            if (!animationEnabled || !animationError) {
                return;
            }
            const attempt = useThumbnailRailStore
                .getState()
                .getTile(instanceKey).attempt;
            failAttempt(instanceKey, attempt, "server");
        },
        [animationEnabled, animationError, instanceKey, failAttempt],
    );

    // --- Animation image browser-readiness handlers (attempt + URL scoped) ---

    const onAnimationLoad = useCallback(
        function (event: React.SyntheticEvent<HTMLImageElement>) {
            if (animationUrl === undefined) {
                return;
            }
            const attempt = useThumbnailRailStore
                .getState()
                .getTile(instanceKey).attempt;
            const img = event.currentTarget;
            urlArrived(instanceKey, attempt, animationUrl);
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;
            // The store's `imageLoaded` records readiness; for zero dimensions
            // it marks the url broken and delegates to `failAttempt` itself, so
            // we only report the load here and stop.
            imageLoaded(instanceKey, attempt, animationUrl, {
                naturalWidth,
                naturalHeight,
            });
            if (naturalWidth <= 0 || naturalHeight <= 0) {
                return;
            }
            // Dimensions mean the browser has a real frame. Reveal that frame
            // now. decode() can hang for an animated WebP that is not yet
            // visible, so it only reports a later failure.
            imageDecoded(instanceKey, attempt, animationUrl);
            if (typeof img.decode === "function") {
                img.decode().then(
                    function () {},
                    function () {
                        imageBroken(
                            instanceKey,
                            attempt,
                            animationUrl,
                            "image-decode",
                        );
                        failAttempt(instanceKey, attempt, "image-decode");
                    },
                );
            }
        },
        [
            animationUrl,
            instanceKey,
            imageLoaded,
            imageDecoded,
            imageBroken,
            failAttempt,
            urlArrived,
        ],
    );

    const onAnimationRef = useCallback(
        function (node: HTMLImageElement | null) {
            if (!node || !node.complete) {
                return;
            }
            onAnimationLoad({
                currentTarget: node,
            } as React.SyntheticEvent<HTMLImageElement>);
        },
        [onAnimationLoad],
    );
    const onAnimationError = useCallback(
        function () {
            if (animationUrl === undefined) {
                return;
            }
            const attempt = useThumbnailRailStore
                .getState()
                .getTile(instanceKey).attempt;
            imageBroken(instanceKey, attempt, animationUrl, "image-load");
            failAttempt(instanceKey, attempt, "image-load");
        },
        [animationUrl, instanceKey, imageBroken, failAttempt],
    );

    const ref = visibilityRef;
    const activity = usePreviewActivity(instanceKey, isVideo, onActiveChange);
    const resourceKey = thumbnailResourceKey(resource);
    useEffect(
        function () {
            const queryKey = dStorageThumbnailQueryKey(
                resource,
                userId,
                "animation",
            );
            registerAnimation?.(instanceKey, queryKey);
            return function () {
                registerAnimation?.(instanceKey, null);
            };
        },
        [registerAnimation, instanceKey, userId, resourceKey],
    );

    // The animation layer is only revealed when readiness is verified for the
    // current attempt and URL and the lifecycle has reached ready.
    const animationRevealed =
        tile.readiness.state === "ready" &&
        tile.lifecycle.state === "ready" &&
        animationUrl !== undefined &&
        tile.readiness.url === animationUrl &&
        tile.readiness.attempt === tile.attempt;

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
            posterLoaded(instanceKey, posterUrl, loaded.naturalWidth);
        },
        onPosterError: function () {
            if (posterUrl === undefined) {
                return;
            }
            posterBroken(instanceKey, posterUrl);
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
                  onRef: onAnimationRef,
              }
            : undefined;

    return {
        ref,
        activity,
        isVideo,
        poster: poster_.frame,
        isLoading: poster_.isLoading,
        animation: animationFrame,
        rail: railView(tile.lifecycle, fileName),
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
    instanceKey: string,
    isVideo: boolean,
    onActiveChange: ((instanceKey: string, active: boolean) => void) | undefined,
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
                instanceKey,
                hovered.current || focused.current || touchHeld.current,
            );
        },
        [instanceKey],
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
                    onChangeRef.current?.(instanceKey, false);
                }
            };
        },
        [instanceKey],
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
