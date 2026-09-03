import React from "react";
import { useController, useFormContext } from "react-hook-form";
import { TextField } from "../TextField";
import type { UploadFormValues } from "./types";

export function UploadFileNameField({
    index,
    isDisabled,
    "aria-label": ariaLabel,
}: {
    index: number;
    isDisabled?: boolean;
    "aria-label": string;
}) {
    const { control } = useFormContext<UploadFormValues>();
    const {
        field: { name, value, onChange, onBlur, ref },
        fieldState: { invalid, error },
    } = useController({
        control,
        name: `files.${index}.fileName`,
        rules: {
            required: "A file name is required.",
            validate: (value) =>
                value.trim().length > 0 || "A file name is required.",
        },
    });

    return (
        <TextField
            aria-label={ariaLabel}
            name={name}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            ref={ref}
            isRequired
            // Let React Hook Form handle validation instead of the browser.
            validationBehavior="aria"
            isInvalid={invalid}
            errorMessage={error?.message}
            isDisabled={isDisabled}
        />
    );
}
