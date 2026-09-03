/**
 * Uppy owns the staged file set; these rows only mirror it so the destination
 * file name of each upload stays editable through React Hook Form.
 */
export type UploadFormValues = {
    files: { uppyFileId: string; fileName: string }[];
};

export type CopyFormValues = {
    destinationBucket: string;
    destinationFileName: string;
};
