import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { FileIcon } from "lucide-react";
import { cy } from "@/utils/cy";
import type { JobProgress } from "@/server/requestJob";
import createThumbnailGetQueryOptions, {
    thumbnailKind,
} from "../queryOptions/createThumbnailGet.ts";

type AnimationGeneration =
    | { readonly state: "inactive" }
    | {
          readonly state: "generating";
          readonly phase: JobProgress["phase"];
          readonly completed: number;
          readonly total: number;
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
            ref={preview.ref}
            className="relative aspect-[8/5] w-full overflow-hidden rounded-md bg-drac-selection"
            onPointerEnter={preview.activity.onPointerEnter}
            onPointerLeave={preview.activity.onPointerLeave}
            onFocus={preview.activity.onFocus}
            onBlur={preview.activity.onBlur}
        >
            <div aria-hidden className="h-full w-full">
                {preview.image ? (
                    <img
                        {...cy(preview.image.selector)}
                        alt=""
                        src={preview.image.url}
                        width={512}
                        height={320}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        onLoad={preview.image.onLoad}
                        onError={preview.image.onError}
                    />
                ) : (
                    <ThumbnailFallback
                        fileName={fileName}
                        isLoading={preview.isLoading}
                    />
                )}
            </div>
            {preview.generation.state === "generating" ? (
                <AnimationProgress
                    fileName={fileName}
                    progress={preview.generation}
                />
            ) : null}
        </div>
    );
}

function useThumbnailPreview(
    fileName: string,
    sourceKey: string,
    isActive: boolean,
    onActiveChange: ((sourceKey: string, active: boolean) => void) | undefined,
) {
    const kind = thumbnailKind(fileName);
    const { ref: visibilityRef, isVisible } = useBecameVisible();
    const [poster, setPoster] = useState<PosterLoadState>({ state: "idle" });
    // Broken animation state is scoped to the URL that failed so a later,
    // different animation URL for this source can still load.
    const [brokenAnimationUrl, setBrokenAnimationUrl] = useState<
        string | null
    >(null);
    // Progress is tagged with the attempt that produced it. A stale callback
    // from a superseded attempt is ignored, and leaving/supersession retires
    // the attempt so old progress cannot flash on a later activation.
    const attemptRef = useRef(0);
    const [progress, setProgress] = useState<{
        readonly attempt: number;
        readonly value: JobProgress;
    } | null>(null);

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

    const animationEnabled =
        kind === "video" && isVisible && isActive && posterReady;

    // When eligibility turns on, bump the attempt token so results and
    // progress from any prior attempt are treated as stale. When it turns off
    // (leave / supersession / gating), retire the visible progress.
    useEffect(
        function () {
            if (animationEnabled) {
                attemptRef.current += 1;
            } else {
                setProgress(null);
            }
        },
        [animationEnabled],
    );

    const activeAttempt = attemptRef.current;
    const onProgress = useCallback(
        function (value: JobProgress) {
            const attempt = attemptRef.current;
            setProgress({ attempt, value });
        },
        // attemptRef is stable; capture happens at call time.
        [],
    );

    const animation = useQuery({
        ...createThumbnailGetQueryOptions(sourceKey, "animation", onProgress),
        enabled: animationEnabled,
    });

    // Only the active attempt's progress is shown; anything else is stale.
    const generation: AnimationGeneration =
        isActive &&
        animationEnabled &&
        animation.fetchStatus === "fetching" &&
        progress &&
        progress.attempt === activeAttempt
            ? {
                  state: "generating",
                  phase: progress.value.phase,
                  completed: progress.value.completed,
                  total: progress.value.total,
              }
            : { state: "inactive" };

    const ref = visibilityRef;
    const activity = usePreviewActivity(sourceKey, onActiveChange);

    const animationUrl = animation.data?.url;
    const image = displayedThumbnail({
        kind,
        isActive,
        isVisible,
        posterState: poster,
        posterUrl,
        posterFailed: posterQuery.isError,
        posterLoading: posterQuery.fetchStatus === "fetching",
        animationUrl,
        animationBroken:
            animationUrl !== undefined && animationUrl === brokenAnimationUrl,
        onPosterLoad: function (event: React.SyntheticEvent<HTMLImageElement>) {
            if (posterUrl === undefined) {
                return;
            }
            const loaded = event.currentTarget;
            // A broken image can still fire load with zero natural size, so
            // require real dimensions before marking the poster ready.
            if (loaded.naturalWidth <= 0) {
                setPoster({ state: "broken", url: posterUrl });
                return;
            }
            setPoster(function (current) {
                // Ignore a load event that belongs to a replaced URL.
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
        onAnimationError: function () {
            if (animationUrl !== undefined) {
                setBrokenAnimationUrl(animationUrl);
            }
        },
    });

    return {
        ref,
        activity,
        image: image.frame,
        isLoading: image.isLoading,
        generation,
    };
}

function AnimationProgress({
    fileName,
    progress,
}: {
    fileName: string;
    progress: Extract<AnimationGeneration, { state: "generating" }>;
}): React.ReactNode {
    const shown =
        progress.phase === "encoding" ? progress.total : progress.completed;
    return (
        <ProgressBar
            {...cy("dStorage_thumbnail_progress")}
            value={shown}
            minValue={0}
            maxValue={progress.total}
            aria-label={`Generating animated preview for ${fileName}`}
            valueLabel={`${shown} of ${progress.total}`}
            className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-md bg-drac-background/80 px-2 py-1"
        >
            {function ({ percentage }) {
                const width = typeof percentage === "number" ? percentage : 0;
                return (
                    <>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-drac-selection forced-colors:bg-[Canvas] forced-colors:outline forced-colors:outline-1 forced-colors:outline-[ButtonBorder]">
                            <div
                                className="h-full rounded-full bg-drac-red transition-[width] duration-150 forced-colors:bg-[Highlight]"
                                style={{ width: `${width}%` }}
                            />
                        </div>
                        <span className="font-sans text-xs tabular-nums text-drac-red">
                            {Math.round(width)}%
                        </span>
                    </>
                );
            }}
        </ProgressBar>
    );
}

function displayedThumbnail(input: {
    kind: ReturnType<typeof thumbnailKind>;
    isActive: boolean;
    isVisible: boolean;
    posterState: PosterLoadState;
    posterUrl: string | undefined;
    posterFailed: boolean;
    posterLoading: boolean;
    animationUrl: string | undefined;
    animationBroken: boolean;
    onPosterLoad: (event: React.SyntheticEvent<HTMLImageElement>) => void;
    onPosterError: () => void;
    onAnimationError: () => void;
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
    const noop = function () {};
    const showAnimation =
        input.kind === "video" &&
        input.isActive &&
        !input.animationBroken &&
        input.animationUrl !== undefined;
    if (showAnimation && input.animationUrl) {
        return {
            frame: {
                url: input.animationUrl,
                selector: "dStorage_thumbnail_animation",
                onLoad: noop,
                onError: input.onAnimationError,
            },
            isLoading: false,
        };
    }
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

// Reports pointer-within and focus-within transitions for this tile to the
// grid coordinator. Pointer and focus are independent: a pointer leave must
// not deactivate a focused tile and vice versa, so each modality is tracked
// separately and the combined "any modality active" boolean is emitted, which
// lets the coordinator compose latest-active ownership across tiles.
//
// Handlers are declarative React props on the thumbnail root rather than
// native listeners installed in an effect. A listener installed after first
// paint can miss a very early pointer event (synthetic or real) that lands
// before the effect runs; a React handler is attached as part of the same
// commit that renders the element, so no early entry is dropped.
function usePreviewActivity(
    sourceKey: string,
    onActiveChange: ((sourceKey: string, active: boolean) => void) | undefined,
): {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocus: () => void;
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
} {
    const onChangeRef = useRef(onActiveChange);
    useEffect(
        function () {
            onChangeRef.current = onActiveChange;
        },
        [onActiveChange],
    );
    const pointerWithin = useRef(false);
    const focusWithin = useRef(false);
    const emit = useCallback(
        function () {
            onChangeRef.current?.(
                sourceKey,
                pointerWithin.current || focusWithin.current,
            );
        },
        [sourceKey],
    );
    // On unmount/detach report inactive so the coordinator drops this
    // candidate and cancels any obsolete client work.
    useEffect(
        function () {
            return function () {
                if (pointerWithin.current || focusWithin.current) {
                    pointerWithin.current = false;
                    focusWithin.current = false;
                    onChangeRef.current?.(sourceKey, false);
                }
            };
        },
        [sourceKey],
    );
    const onPointerEnter = useCallback(
        function () {
            pointerWithin.current = true;
            emit();
        },
        [emit],
    );
    const onPointerLeave = useCallback(
        function () {
            pointerWithin.current = false;
            emit();
        },
        [emit],
    );
    const onFocus = useCallback(
        function () {
            focusWithin.current = true;
            emit();
        },
        [emit],
    );
    const onBlur = useCallback(
        function (event: React.FocusEvent<HTMLDivElement>) {
            // Keep focus-within while focus moves to a descendant of the tile.
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) {
                return;
            }
            focusWithin.current = false;
            emit();
        },
        [emit],
    );
    return { onPointerEnter, onPointerLeave, onFocus, onBlur };
}
