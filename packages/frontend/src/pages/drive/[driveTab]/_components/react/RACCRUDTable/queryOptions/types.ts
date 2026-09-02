import type { ObjectKeyParts } from "@/utils/storage/objectKey";

/** Wire shape returned by GET /api/storage/buckets/{bucket}/objects. */
export type StorageListItem = {
    key: string;
};

export type StorageRow = StorageListItem & ObjectKeyParts;
