export type PendingUpload = {
    storageObjectId: string;
    storageObjectDataId: string;
    fileName: string;
    isNewObject: boolean;
    s3ObjectKey: string;
};
