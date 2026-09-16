import { useEffect, useState } from "react";
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";
import { storageBasePath } from "../queryOptions/paths";
import type { PendingUpload } from "@/utils/storage/pendingUpload";

/** Matches the generics `UppyContextProvider` expects, so no casting is needed. */
export type StorageUppy = Uppy;
export type StorageUppyFile = ReturnType<StorageUppy["getFiles"]>[number];

export const MAX_UPLOAD_FILES = 10;

type PresignResponse = {
    url: string;
    key: string;
    pendingUpload: PendingUpload;
};

function isPresignResponse(body: unknown): body is PresignResponse {
    if (typeof body !== "object" || body === null) {
        return false;
    }
    const value = body as Record<string, unknown>;
    return (
        typeof value.url === "string" &&
        typeof value.key === "string" &&
        typeof value.pendingUpload === "object" &&
        value.pendingUpload !== null
    );
}

function fileNameOf(file: {
    name?: string;
    meta?: Record<string, unknown>;
}): string | undefined {
    if (typeof file.meta?.name === "string" && file.meta.name.length > 0) {
        return file.meta.name;
    }
    if (typeof file.name === "string" && file.name.length > 0) {
        return file.name;
    }
    return undefined;
}

function createStorageUppy(bucketName: string): StorageUppy {
    const objectsPath = `${storageBasePath(bucketName)}/objects`;
    const pendingByS3Key = new Map<string, PendingUpload>();

    async function postPending(action: "commit" | "abort", pending: PendingUpload) {
        const response = await fetch(`${objectsPath}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pending),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(text || `${action} failed (${response.status})`);
        }
    }

    const uppy = new Uppy({
        autoProceed: false,
        restrictions: { maxNumberOfFiles: MAX_UPLOAD_FILES },
    }).use(AwsS3, {
        shouldUseMultipart: false,
        limit: 1,
        generateObjectKey: (file) => {
            const name = fileNameOf(file);
            if (!name) {
                throw new Error("file name is required");
            }
            return name;
        },
        async signRequest({ method, key }) {
            if (method !== "PUT") {
                throw new Error(`unsupported S3 ${method} for ${key}`);
            }

            const response = await fetch(
                `${objectsPath}/presign?fileName=${encodeURIComponent(key)}`,
                { method: "POST" },
            );
            const body: unknown = await response.json().catch(() => null);

            if (!response.ok || !isPresignResponse(body)) {
                throw new Error(
                    `Could not prepare upload for ${key} (${response.status})`,
                );
            }

            pendingByS3Key.set(body.key, body.pendingUpload);
            return { url: body.url, key: body.key };
        },
    });

    uppy.addPostProcessor(async (fileIDs) => {
        for (const id of fileIDs) {
            const file = uppy.getFile(id);
            const s3Key =
                file.response?.body &&
                typeof file.response.body === "object" &&
                "key" in file.response.body
                    ? String(file.response.body.key)
                    : undefined;
            const pending = s3Key ? pendingByS3Key.get(s3Key) : undefined;
            if (!pending) {
                continue;
            }

            await postPending("commit", pending);
            pendingByS3Key.delete(pending.s3ObjectKey);
        }
    });

    uppy.on("upload-error", (file) => {
        const pending = [...pendingByS3Key.values()].find(
            (entry) => file != null && entry.fileName === fileNameOf(file),
        );
        if (!pending) {
            return;
        }
        pendingByS3Key.delete(pending.s3ObjectKey);
        void postPending("abort", pending).catch(() => {});
    });

    return uppy;
}

/**
 * Owns one Uppy instance per mount. The upload dialog lives inside a React Aria
 * `Modal`, which unmounts on close, so every open starts from an empty file set.
 */
export function useStorageUppy(bucketName: string): StorageUppy {
    const [uppy] = useState(() => createStorageUppy(bucketName));

    useEffect(() => () => uppy.destroy(), [uppy]);

    return uppy;
}
