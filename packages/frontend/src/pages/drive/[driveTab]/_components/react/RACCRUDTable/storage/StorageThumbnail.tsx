import React, { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileIcon } from "lucide-react";
import { cy } from "@/utils/cy";
import createThumbnailGetQueryOptions, {
    isPreviewableImage,
} from "../queryOptions/createThumbnailGet.ts";

interface StorageThumbnailProps {
    fileName: string;
    sourceKey: string;
}

export function StorageThumbnail({
    fileName,
    sourceKey,
}: StorageThumbnailProps): React.ReactNode {
    const previewable = isPreviewableImage(fileName);
    const { ref, isVisible } = useBecameVisible();
    const thumbnail = useQuery({
        ...createThumbnailGetQueryOptions(sourceKey),
        enabled: previewable && isVisible,
    });
    const image =
        previewable && !thumbnail.isError ? thumbnail.data : undefined;

    return (
        <div
            {...cy("dStorage_thumbnail")}
            ref={ref}
            aria-hidden
            className="relative aspect-[8/5] w-full overflow-hidden rounded-md bg-drac-selection"
        >
            {image ? (
                <img
                    {...cy("dStorage_thumbnail_image")}
                    alt=""
                    src={image.url}
                    width={512}
                    height={320}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                />
            ) : (
                <ThumbnailFallback
                    fileName={fileName}
                    isLoading={
                        previewable &&
                        isVisible &&
                        thumbnail.fetchStatus === "fetching"
                    }
                />
            )}
        </div>
    );
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
    const observerRef = useRef<IntersectionObserver | null>(null);
    const ref = useCallback(
        function (node: HTMLDivElement | null) {
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
