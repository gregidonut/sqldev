import { emptyBucket as emptySqlDevBucket } from "@sqldev/core/s3";

export async function emptyBucket(): Promise<{ deleted: number }> {
  return emptySqlDevBucket();
}
