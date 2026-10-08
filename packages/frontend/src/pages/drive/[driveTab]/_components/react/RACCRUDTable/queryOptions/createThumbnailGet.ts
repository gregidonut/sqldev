import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";

const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 320;
const THUMBNAIL_FIT = "cover";
const THUMBNAIL_FORMAT = "webp";
const THUMBNAIL_QUALITY = 80;

const PREVIEWABLE_EXTENSIONS = [
    "avif",
    "bmp",
    "gif",
    "heic",
    "heif",
    "jpeg",
    "jpg",
    "png",
    "tif",
    "tiff",
    "webp",
] as const;

const STORAGE_DATA_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ThumbnailContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export type StorageThumbnail = {
    readonly url: string;
    readonly contentType: ThumbnailContentType;
};

type ThumbnailRequest = {
    readonly sourceKey: string;
    readonly width: typeof THUMBNAIL_WIDTH;
    readonly height: typeof THUMBNAIL_HEIGHT;
    readonly fit: typeof THUMBNAIL_FIT;
    readonly format: typeof THUMBNAIL_FORMAT;
    readonly quality: typeof THUMBNAIL_QUALITY;
};

export function isPreviewableImage(fileName: string): boolean {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0 || dot === fileName.length - 1) {
        return false;
    }
    const extension = fileName.slice(dot + 1).toLowerCase();
    return PREVIEWABLE_EXTENSIONS.some(function (candidate) {
        return candidate === extension;
    });
}

export function thumbnailIdempotencyKey(sourceKey: string): string {
    const storageDataId = sourceKey.split("/")[2] ?? "";
    const version = STORAGE_DATA_ID.test(storageDataId)
        ? storageDataId
        : compactKey(sourceKey);
    return `thumb:${version}:${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}:${THUMBNAIL_FIT}:${THUMBNAIL_FORMAT}:${THUMBNAIL_QUALITY}`;
}

export function dStorageThumbnailQueryKey(sourceKey: string) {
    return [
        "get",
        "dStorage",
        "thumbnail",
        {
            sourceKey,
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
            fit: THUMBNAIL_FIT,
            format: THUMBNAIL_FORMAT,
            quality: THUMBNAIL_QUALITY,
        },
    ] as const;
}

export default function createThumbnailGetQueryOptions(sourceKey: string) {
    const request = {
        sourceKey,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        fit: THUMBNAIL_FIT,
        format: THUMBNAIL_FORMAT,
        quality: THUMBNAIL_QUALITY,
    } as const satisfies ThumbnailRequest;

    return queryOptions({
        queryKey: dStorageThumbnailQueryKey(sourceKey),
        queryFn: async function (): Promise<StorageThumbnail> {
            const result = await requestJob<unknown>({
                method: "POST",
                url: "/api/images/transform",
                data: request,
                headers: {
                    "Idempotency-Key": thumbnailIdempotencyKey(sourceKey),
                },
            });
            return parseThumbnail(result);
        },
        staleTime: 4 * 60 * 1000,
        gcTime: 4 * 60 * 1000,
        retry: 1,
    });
}

function parseThumbnail(value: unknown): StorageThumbnail {
    if (!isRecord(value)) {
        throw new Error("thumbnail response is invalid");
    }
    if (typeof value.url !== "string" || !isHttpUrl(value.url)) {
        throw new Error("thumbnail response is invalid");
    }
    if (!isThumbnailContentType(value.contentType)) {
        throw new Error("thumbnail response is invalid");
    }
    return {
        url: value.url,
        contentType: value.contentType,
    };
}

function isThumbnailContentType(value: unknown): value is ThumbnailContentType {
    return IMAGE_CONTENT_TYPES.some(function (contentType) {
        return contentType === value;
    });
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactKey(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}
