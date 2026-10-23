import { queryOptions } from "@tanstack/react-query";
import { requestJob, type JobProgress } from "@/server/requestJob";

const THUMBNAIL_WIDTH = 512;
const THUMBNAIL_HEIGHT = 320;
const THUMBNAIL_FIT = "cover";
const THUMBNAIL_FORMAT = "webp";
const THUMBNAIL_QUALITY = 80;

const IMAGE_EXTENSIONS = [
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

const VIDEO_EXTENSIONS = [
    "avi",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpeg",
    "mpg",
    "webm",
] as const;

const STORAGE_DATA_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ThumbnailContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export type ThumbnailKind = "image" | "pdf" | "video";

export type ThumbnailPreview = ThumbnailKind | "animation";

export type StorageThumbnail = {
    readonly url: string;
    readonly contentType: ThumbnailContentType;
};

export type ThumbnailResource =
    | { readonly kind: "source"; readonly sourceKey: string }
    | {
          readonly kind: "object";
          readonly storageObjectId: string;
          readonly revisionId: string;
      };

type ThumbnailRequest = {
    readonly width: typeof THUMBNAIL_WIDTH;
    readonly height: typeof THUMBNAIL_HEIGHT;
    readonly fit: typeof THUMBNAIL_FIT;
    readonly format: typeof THUMBNAIL_FORMAT;
    readonly quality: typeof THUMBNAIL_QUALITY;
    readonly preview: ThumbnailPreview;
};

export function thumbnailResourceKey(resource: ThumbnailResource): string {
    if (resource.kind === "source") {
        return resource.sourceKey;
    }
    return `object:${resource.storageObjectId}:${resource.revisionId}`;
}

export function thumbnailKind(fileName: string): ThumbnailKind | undefined {
    const extension = fileExtension(fileName);
    if (extension === "pdf") {
        return "pdf";
    }
    if (hasExtension(VIDEO_EXTENSIONS, extension)) {
        return "video";
    }
    if (hasExtension(IMAGE_EXTENSIONS, extension)) {
        return "image";
    }
    return undefined;
}

export function thumbnailIdempotencyKey(
    resource: ThumbnailResource,
    preview: ThumbnailPreview,
): string {
    const version =
        resource.kind === "object"
            ? resource.revisionId
            : sourceVersion(resource.sourceKey);
    return `thumb:${version}:${preview}:${THUMBNAIL_WIDTH}x${THUMBNAIL_HEIGHT}:${THUMBNAIL_FIT}:${THUMBNAIL_FORMAT}:${THUMBNAIL_QUALITY}`;
}

export function dStorageThumbnailQueryKey(
    resource: ThumbnailResource,
    userId: string,
    preview: ThumbnailPreview,
) {
    return [
        "get",
        "dStorage",
        "thumbnail",
        userId,
        thumbnailResourceKey(resource),
        {
            preview,
            width: THUMBNAIL_WIDTH,
            height: THUMBNAIL_HEIGHT,
            fit: THUMBNAIL_FIT,
            format: THUMBNAIL_FORMAT,
            quality: THUMBNAIL_QUALITY,
        },
    ] as const;
}

export default function createThumbnailGetQueryOptions(
    resource: ThumbnailResource,
    userId: string,
    preview: ThumbnailPreview,
    onProgress?: (progress: JobProgress) => void,
) {
    const options = {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        fit: THUMBNAIL_FIT,
        format: THUMBNAIL_FORMAT,
        quality: THUMBNAIL_QUALITY,
        preview,
    } as const satisfies ThumbnailRequest;
    const request =
        resource.kind === "source"
            ? { ...options, sourceKey: resource.sourceKey }
            : {
                  ...options,
                  storageObjectId: resource.storageObjectId,
                  revisionId: resource.revisionId,
              };

    return queryOptions({
        queryKey: dStorageThumbnailQueryKey(resource, userId, preview),
        queryFn: async function ({ signal }): Promise<StorageThumbnail> {
            const result = await requestJob<unknown>(
                {
                    method: "POST",
                    url:
                        resource.kind === "source"
                            ? "/api/images/transform"
                            : "/api/storage/references/preview",
                    data: request,
                    headers: {
                        "Idempotency-Key": thumbnailIdempotencyKey(
                            resource,
                            preview,
                        ),
                    },
                },
                {
                    signal,
                    pollIntervalMs: preview === "animation" ? 200 : undefined,
                    onProgress:
                        preview === "animation" ? onProgress : undefined,
                },
            );
            return parseThumbnail(result);
        },
        staleTime: 4 * 60 * 1000,
        gcTime: 4 * 60 * 1000,
        // Drive's failure-rail spec advances exactly one TanStack retry.
        retry: 1,
    });
}

function sourceVersion(sourceKey: string): string {
    const storageDataId = sourceKey.split("/")[2] ?? "";
    return STORAGE_DATA_ID.test(storageDataId)
        ? storageDataId
        : compactKey(sourceKey);
}

function fileExtension(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    if (dot < 0 || dot === fileName.length - 1) {
        return "";
    }
    return fileName.slice(dot + 1).toLowerCase();
}

function hasExtension(
    extensions: readonly string[],
    extension: string,
): boolean {
    return extensions.some(function (candidate) {
        return candidate === extension;
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
