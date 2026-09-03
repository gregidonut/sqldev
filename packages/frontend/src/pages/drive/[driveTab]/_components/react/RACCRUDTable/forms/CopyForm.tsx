import React from "react";
import { useMutation } from "@tanstack/react-query";
import { FormProvider, useForm } from "react-hook-form";
import { Heading } from "react-aria-components/Heading";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { Form } from "../Form";
import { toErrorMessage } from "../storage/storageDisplay.tsx";
import createCopyPostMutationOptions from "../queryOptions/createCopyPost";
import type { StorageRow } from "../queryOptions/types";
import { DestinationBucketField } from "./DestinationBucketField";
import { DestinationFileNameField } from "./DestinationFileNameField";
import type { CopyFormValues } from "./types";

type CopyFormProps = {
    item: StorageRow;
    bucketName: string;
    userId: string;
};

export function CopyForm(props: CopyFormProps) {
    return (
        <Dialog>
            {({ close }) => <CopyFormFields {...props} close={close} />}
        </Dialog>
    );
}

function CopyFormFields({
    item,
    bucketName,
    userId,
    close,
}: CopyFormProps & { close: () => void }) {
    const methods = useForm<CopyFormValues>({
        defaultValues: {
            destinationBucket: bucketName,
            destinationFileName: item.file_name,
        },
    });
    const copy = useMutation(
        createCopyPostMutationOptions({ userId, bucketName }),
    );

    const onSubmit = methods.handleSubmit(
        ({ destinationBucket, destinationFileName }) => {
            copy.mutate(
                {
                    key: item.s3_object_key,
                    destinationBucket: destinationBucket.trim(),
                    destinationFileName: destinationFileName.trim(),
                },
                {
                    onSuccess: () => {
                        methods.reset();
                        close();
                    },
                },
            );
        },
    );

    return (
        <FormProvider {...methods}>
            <Heading
                slot="title"
                className="my-0 text-xl leading-6 font-semibold text-drac-foreground"
            >
                Copy “{item.file_name}”
            </Heading>
            <Form
                onSubmit={onSubmit}
                validationBehavior="aria"
                className="mt-6"
            >
                <DestinationBucketField isDisabled={copy.isPending} />
                <DestinationFileNameField isDisabled={copy.isPending} />
                {copy.isError && (
                    <p
                        role="alert"
                        className="text-sm text-drac-red forced-colors:text-[Mark]"
                    >
                        {toErrorMessage(copy.error, "The copy failed.")}
                    </p>
                )}
                <div className="mt-6 flex justify-end gap-2">
                    <Button
                        variant="secondary"
                        onPress={close}
                        isDisabled={copy.isPending}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        isPending={copy.isPending}
                        isDisabled={copy.isPending}
                    >
                        Copy
                    </Button>
                </div>
            </Form>
        </FormProvider>
    );
}
