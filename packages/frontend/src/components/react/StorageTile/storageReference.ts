import { queryOptions } from "@tanstack/react-query";
import { requestJob } from "@/server/requestJob";
import { isStorageObjectId } from "./splitStorageHtml.ts";

export type StorageReference =
    | { readonly kind: "unavailable" }
    | {
          readonly kind: "ready";
          readonly fileName: string;
          readonly revisionId: string;
      };

export function storageReferenceQueryOptions(
    userId: string,
    storageObjectId: string,
) {
    return queryOptions({
        queryKey: ["get", "storageReference", userId, storageObjectId] as const,
        enabled: userId !== "" && isStorageObjectId(storageObjectId),
        queryFn: async function ({ signal }): Promise<StorageReference> {
            const result = await requestJob<unknown>(
                {
                    method: "POST",
                    url: "/api/storage/references",
                    data: { storageObjectId },
                },
                { signal },
            );
            return parseStorageReference(result);
        },
        staleTime: 0,
        gcTime: 60 * 1000,
        retry: 4,
    });
}

export function parseStorageReference(value: unknown): StorageReference {
    if (!isRecord(value)) {
        throw new Error("storage reference is invalid");
    }
    if (value.kind === "unavailable" && hasExactKeys(value, ["kind"])) {
        return { kind: "unavailable" };
    }
    if (
        value.kind === "ready" &&
        hasExactKeys(value, ["kind", "fileName", "revisionId"]) &&
        typeof value.fileName === "string" &&
        value.fileName.trim() !== "" &&
        typeof value.revisionId === "string" &&
        isStorageObjectId(value.revisionId)
    ) {
        return {
            kind: "ready",
            fileName: value.fileName,
            revisionId: value.revisionId,
        };
    }
    throw new Error("storage reference is invalid");
}

function hasExactKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
): boolean {
    const actual = Object.keys(value);
    return (
        actual.length === keys.length &&
        keys.every(function (key) {
            return actual.includes(key);
        })
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
