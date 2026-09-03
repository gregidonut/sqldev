import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { Heading } from "react-aria-components/Heading";
import {
    UppyContextProvider,
    useUppyContext,
    useUppyEvent,
    useUppyState,
} from "@uppy/react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { Form } from "../Form";
import { toErrorMessage } from "../storage/storageDisplay";
import { dStorageListKeyPrefix } from "../queryOptions/createListGet";
import { UploadFileField } from "./UploadFileField";
import { UploadFileRow } from "./UploadFileRow";
import { useStorageUppy, type StorageUppy } from "./useStorageUppy";
import type { UploadFormValues } from "./types";

type UploadFormProps = {
    bucketName: string;
    userId: string;
};

export function UploadForm(props: UploadFormProps) {
    return (
        <Dialog>
            {({ close }) => <UploadFormFields {...props} close={close} />}
        </Dialog>
    );
}

function UploadFormFields({
    bucketName,
    userId,
    close,
}: UploadFormProps & { close: () => void }) {
    const uppy = useStorageUppy(bucketName);

    return (
        <UppyContextProvider uppy={uppy}>
            <UploadFormBody uppy={uppy} userId={userId} close={close} />
        </UppyContextProvider>
    );
}

function UploadFormBody({
    uppy,
    userId,
    close,
}: {
    uppy: StorageUppy;
    userId: string;
    close: () => void;
}) {
    const queryClient = useQueryClient();
    const { status } = useUppyContext();
    const [uploadError, setUploadError] = useState<string | null>(null);

    const isUploading = status === "uploading";

    // Uppy owns the staged file set; the form only mirrors the editable names,
    // so rows are rendered in field-array order to keep the indexes aligned.
    const files = useUppyState(uppy, (state) => state.files);
    const methods = useForm<UploadFormValues>({
        defaultValues: { files: [] },
    });
    const { fields, append, remove } = useFieldArray({
        control: methods.control,
        name: "files",
    });

    useUppyEvent(uppy, "file-added", (file) => {
        append({ uppyFileId: file.id, fileName: file.meta.name });
    });

    useUppyEvent(uppy, "file-removed", (file) => {
        const index = methods
            .getValues("files")
            .findIndex((row) => row.uppyFileId === file.id);
        if (index !== -1) {
            remove(index);
        }
    });

    useUppyEvent(uppy, "restriction-failed", (_file, error) => {
        setUploadError(toErrorMessage(error, "That file was rejected."));
    });

    useUppyEvent(uppy, "upload-error", (file, error) => {
        setUploadError(
            error.message || `Uploading ${file?.name ?? "the file"} failed.`,
        );
    });

    useUppyEvent(uppy, "complete", (result) => {
        if ((result.successful ?? []).length > 0) {
            void queryClient.invalidateQueries({
                queryKey: dStorageListKeyPrefix(userId),
            });
        }

        // Keep the dialog open when something failed so those rows stay
        // visible and can be renamed or removed before retrying.
        if ((result.failed ?? []).length === 0) {
            close();
        }
    });

    const onSubmit = methods.handleSubmit(async ({ files: rows }) => {
        setUploadError(null);

        for (const row of rows) {
            uppy.setFileMeta(row.uppyFileId, { name: row.fileName.trim() });
        }

        try {
            await uppy.upload();
        } catch (error) {
            setUploadError(toErrorMessage(error, "The upload failed."));
        }
    });

    return (
        <FormProvider {...methods}>
            <Heading
                slot="title"
                className="my-0 text-xl leading-6 font-semibold text-drac-foreground"
            >
                Upload files
            </Heading>
            <Form
                onSubmit={onSubmit}
                validationBehavior="aria"
                className="mt-6"
            >
                <UploadFileField
                    uppy={uppy}
                    stagedCount={fields.length}
                    isDisabled={isUploading}
                    onStage={() => setUploadError(null)}
                />

                {fields.length > 0 && (
                    <ul className="flex list-none flex-col gap-2 p-0">
                        {fields.map((row, index) => {
                            const file = files[row.uppyFileId];
                            return file ? (
                                <UploadFileRow
                                    key={row.id}
                                    uppy={uppy}
                                    file={file}
                                    index={index}
                                    isUploading={isUploading}
                                />
                            ) : null;
                        })}
                    </ul>
                )}

                {uploadError && (
                    <p
                        role="alert"
                        className="text-sm text-drac-red forced-colors:text-[Mark]"
                    >
                        {uploadError}
                    </p>
                )}

                <div className="mt-6 flex justify-end gap-2">
                    <Button
                        variant="secondary"
                        onPress={close}
                        isDisabled={isUploading}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        isPending={isUploading}
                        isDisabled={isUploading || fields.length === 0}
                    >
                        Upload
                    </Button>
                </div>
            </Form>
        </FormProvider>
    );
}
