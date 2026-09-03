import type { Database } from "@/utils/supabase/models";

/**
 * Wire shape returned by GET /api/storage/buckets/{bucket}/objects. The proxy
 * forwards the `get_d_storage_objects` rows, which carry the same columns as
 * every `d_storage_objects_*_view` but without the nullable view typing.
 */
export type StorageRow =
    Database["public"]["Functions"]["get_d_storage_objects"]["Returns"][number];
