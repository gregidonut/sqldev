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

interface StorageThumbnailProps {
    fileName: string;
    sourceKey: string;
}

export function StorageThumbnail({
    fileName,
    sourceKey,
}: StorageThumbnailProps): React.ReactNode {
    const preview = useThumbnailPreview(fileName, sourceKey);

    return (
        <div
            {...cy("dStorage_thumbnail")}
            ref={preview.ref}
            className="relative aspect-[8/5] w-full overflow-hidden rounded-md bg-drac-selection"
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

function useThumbnailPreview(fileName: string, sourceKey: string) {
    const kind = thumbnailKind(fileName);
    const { ref: visibilityRef, isVisible } = useBecameVisible();
    const [active, setActive] = useState(false);
    const [animationReady, setAnimationReady] = useState(false);
    const [posterBroken, setPosterBroken] = useState(false);
    const [animationBroken, setAnimationBroken] = useState(false);
    const [latestProgress, setLatestProgress] = useState<JobProgress | null>(
        null,
    );
    const poster = useQuery({
        ...createThumbnailGetQueryOptions(sourceKey, kind ?? "image"),
        enabled: kind !== undefined && isVisible,
    });
    const animation = useQuery({
        ...createThumbnailGetQueryOptions(
            sourceKey,
            "animation",
            setLatestProgress,
        ),
        enabled: canRequestAnimation(kind, isVisible, animationReady),
    });
    const generation: AnimationGeneration =
        animation.fetchStatus === "fetching" && latestProgress
            ? {
                  state: "generating",
                  phase: latestProgress.phase,
                  completed: latestProgress.completed,
                  total: latestProgress.total,
              }
            : { state: "inactive" };
    const ref = usePreviewActivity(visibilityRef, function (next) {
        setActive(next);
        if (next && canRequestAnimation(kind, true, true)) {
            setAnimationReady(true);
        }
    });
    const image = displayedThumbnail({
        kind,
        active,
        isVisible,
        posterBroken,
        animationBroken,
        posterUrl: poster.data?.url,
        posterFailed: poster.isError,
        posterLoading: poster.fetchStatus === "fetching",
        animationUrl: animation.data?.url,
        onPosterError: function () {
            setPosterBroken(true);
        },
        onAnimationError: function () {
            setAnimationBroken(true);
        },
    });
    return {
        ref,
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

function canRequestAnimation(
    kind: ReturnType<typeof thumbnailKind>,
    isVisible: boolean,
    animationReady: boolean,
): boolean {
    return kind === "video" && isVisible && animationReady;
}

function displayedThumbnail(input: {
    kind: ReturnType<typeof thumbnailKind>;
    active: boolean;
    isVisible: boolean;
    posterBroken: boolean;
    animationBroken: boolean;
    posterUrl: string | undefined;
    posterFailed: boolean;
    posterLoading: boolean;
    animationUrl: string | undefined;
    onPosterError: () => void;
    onAnimationError: () => void;
}): {
    frame: { url: string; selector: string; onError: () => void } | undefined;
    isLoading: boolean;
} {
    const showAnimation =
        input.kind === "video" &&
        input.active &&
        !input.animationBroken &&
        input.animationUrl !== undefined;
    if (showAnimation && input.animationUrl) {
        return {
            frame: {
                url: input.animationUrl,
                selector: "dStorage_thumbnail_animation",
                onError: input.onAnimationError,
            },
            isLoading: false,
        };
    }
    if (
        input.kind !== undefined &&
        !input.posterFailed &&
        !input.posterBroken &&
        input.posterUrl
    ) {
        return {
            frame: {
                url: input.posterUrl,
                selector: "dStorage_thumbnail_image",
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

function usePreviewActivity(
    ref: (node: HTMLDivElement | null) => void,
    onChange: (active: boolean) => void,
): (node: HTMLDivElement | null) => void {
    const [node, setNode] = useState<HTMLDivElement | null>(null);
    const onChangeRef = useRef(onChange);
    useEffect(
        function () {
            onChangeRef.current = onChange;
        },
        [onChange],
    );
    useEffect(
        function () {
            const item = previewRoot(node);
            if (!item) {
                return;
            }
            const enter = function () {
                onChangeRef.current(true);
            };
            const leave = function (event: Event) {
                const next =
                    event instanceof FocusEvent ? event.relatedTarget : null;
                if (next instanceof Node && item.contains(next)) {
                    return;
                }
                onChangeRef.current(false);
            };
            item.addEventListener("pointerenter", enter);
            item.addEventListener("pointerleave", leave);
            item.addEventListener("focusin", enter);
            item.addEventListener("focusout", leave);
            return function () {
                item.removeEventListener("pointerenter", enter);
                item.removeEventListener("pointerleave", leave);
                item.removeEventListener("focusin", enter);
                item.removeEventListener("focusout", leave);
            };
        },
        [node],
    );
    return useCallback(
        function (next: HTMLDivElement | null) {
            setNode(next);
            ref(next);
        },
        [ref],
    );
}

function previewRoot(node: HTMLElement | null): HTMLElement | null {
    const root = node?.closest("[data-preview-root]");
    if (root instanceof HTMLElement) {
        return root;
    }
    return node?.parentElement ?? null;
}
