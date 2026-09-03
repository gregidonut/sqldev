import { useEffect, useState } from "react";
import Uppy from "@uppy/core";
import XHRUpload from "@uppy/xhr-upload";
import { storageBasePath } from "../queryOptions/paths";

/** Matches the generics `UppyContextProvider` expects, so no casting is needed. */
export type StorageUppy = Uppy;
export type StorageUppyFile = ReturnType<StorageUppy["getFiles"]>[number];

export const MAX_UPLOAD_FILES = 10;

function createStorageUppy(bucketName: string): StorageUppy {
    return new Uppy({
        autoProceed: false,
        restrictions: { maxNumberOfFiles: MAX_UPLOAD_FILES },
    }).use(XHRUpload, {
        endpoint: function (fileOrBundle) {
            // `bundle` defaults to false, so this always receives one file.
            const [file] = Array.isArray(fileOrBundle)
                ? fileOrBundle
                : [fileOrBundle];
            const fileName = encodeURIComponent(file.meta.name);
            return `${storageBasePath(bucketName)}/objects?fileName=${fileName}`;
        },
        fieldName: "file",
        // The proxy reads the name from the query string, so the multipart body
        // stays limited to the single part the Go handler looks for.
        allowedMetaFields: [],
        limit: 1,
        // UploadObject answers 200 with an empty body; without this the default
        // JSON.parse of "" would report every stored object as a failure.
        getResponseData: () => ({}),
    });
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
