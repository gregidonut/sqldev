import React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { TextField } from "../TextField";
import type { CopyFormValues } from "./types";

export function DestinationBucketField({
    isDisabled,
}: {
    isDisabled?: boolean;
}) {
    const { control } = useFormContext<CopyFormValues>();

    return (
        <Controller
            control={control}
            name="destinationBucket"
            rules={{ required: "A destination bucket is required." }}
            render={({
                field: { name, value, onChange, onBlur, ref },
                fieldState: { invalid, error },
            }) => (
                <TextField
                    label="Destination bucket"
                    name={name}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    ref={ref}
                    isRequired
                    validationBehavior="aria"
                    isInvalid={invalid}
                    errorMessage={error?.message}
                    isDisabled={isDisabled}
                />
            )}
        />
    );
}
