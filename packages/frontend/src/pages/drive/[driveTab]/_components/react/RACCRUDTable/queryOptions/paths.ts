export function storageBasePath(bucketName: string): string {
    return `/api/storage/buckets/${encodeURIComponent(bucketName)}`;
}
