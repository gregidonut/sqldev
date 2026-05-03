import React from "react";
import { Controller } from "react-hook-form";
import { TextField } from "@/components/ui/TextField.tsx";
import { useFormSection } from "../FormSectionContext.ts";

export default function TitleField() {
    const control = useFormSection();
    if (!control) {
        throw new Error(
            "useFormSection must be used within a FormSectionProvider",
        );
    }
    return (
        <Controller
            control={control}
            name="p_title"
            rules={{ required: "Title is required." }}
            render={({
                field: { name, value, onChange, onBlur, ref },
                fieldState: { invalid, error },
            }) => (
                <TextField
                    label={name}
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
                />
            )}
        />
    );
}
