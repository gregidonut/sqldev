import React from "react";
import { Controller } from "react-hook-form";
import { useFormSection } from "../FormSectionContext.ts";
import { FieldError, Label, TextArea, TextField } from "react-aria-components";

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
            render={({
                field: { name, value, onChange, onBlur, ref },
                fieldState: { invalid, error },
            }) => (
                <TextField
                    name={name}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    ref={ref}
                    validationBehavior="aria"
                    isInvalid={invalid}
                    errorMessage={error?.message}
                    className="new-todo-field flex-col-start-start gap-1"
                >
                    <Label>{name}</Label>
                    <TextArea
                        rows={4}
                        className="w-full resize-none rounded-sm border-drac-comment px-3 py-2 bg-drac-background field-sizing-content"
                    />
                    <FieldError className="text-drac-red" />
                </TextField>
            )}
        />
    );
}
