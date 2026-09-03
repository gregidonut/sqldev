import React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { TextField } from "../TextField";
import type { CopyFormValues } from "./types";

export function DestinationFileNameField({
    isDisabled,
}: {
    isDisabled?: boolean;
}) {
    const { control } = useFormContext<CopyFormValues>();

    return (
        <Controller
            control={control}
            name="destinationFileName"
            rules={{ required: "A destination file name is required." }}
            render={({
                field: { name, value, onChange, onBlur, ref },
                fieldState: { invalid, error },
            }) => (
                <TextField
                    label="Destination file name"
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
