import React from "react";
import { Controller } from "react-hook-form";
import { useFormSection } from "../FormSectionContext.ts";
import { FieldError, Label, TextArea, TextField } from "react-aria-components";
// import { TextField } from "@/components/ui/TextField";

export default function DescriptionTextArea() {
    const control = useFormSection();
    if (!control) {
        throw new Error(
            "useFormSection must be used within a FormSectionProvider",
        );
    }
    return (
        <Controller
            control={control}
            name="p_description"
            // rules={{ required: "post teis required." }}
            render={({
                field: { name, value, onChange, onBlur, ref },
                fieldState: { invalid, error: fieldError },
            }) => (
                <TextField
                    name={name}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    ref={ref}
                    isRequired
                    autoFocus
                    validationBehavior="aria"
                    isInvalid={invalid}
                    // errorMessage={fieldError?.message}
                    className="flex-col-start-start gap-1"
                >
                    <Label>{name}</Label>
                    <TextArea
                        rows={4}
                        className="w-full resize-none rounded-sm border-drac-comment px-3 py-2 bg-drac-background field-sizing-content"
                    />
                    {fieldError && (
                        <FieldError className="text-drac-red">
                            {fieldError.message}
                        </FieldError>
                    )}
                </TextField>
            )}
        />
    );
}
