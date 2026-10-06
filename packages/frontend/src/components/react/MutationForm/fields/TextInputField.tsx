import React from "react";
import {
    Controller,
    useFormContext,
    type ControllerProps,
    type FieldValues,
    type Path,
} from "react-hook-form";
import { TextField } from "@/components/ui/TextField";
import { cy } from "@/utils/cy";
import { useMutationFormState } from "../MutationFormContext.ts";
import { textValue } from "./textValue.ts";

export interface TextInputFieldProps<TFieldValues extends FieldValues> {
    name: Path<TFieldValues>;
    rules?: ControllerProps<TFieldValues, Path<TFieldValues>>["rules"];
    label?: string;
    isRequired?: boolean;
    className?: string;
    dataCy?: string;
}

export function TextInputField<TFieldValues extends FieldValues>({
    name,
    rules,
    label,
    isRequired,
    className,
    dataCy,
}: TextInputFieldProps<TFieldValues>) {
    const { control } = useFormContext<TFieldValues>();
    const { isPending } = useMutationFormState();

    return (
        <Controller
            control={control}
            name={name}
            rules={rules}
            render={({
                field: { name: fieldName, value, onChange, onBlur, ref },
                fieldState: { invalid, error },
            }) => (
                <TextField
                    {...(dataCy ? cy(dataCy) : {})}
                    label={label ?? fieldName}
                    name={fieldName}
                    value={textValue(value)}
                    onChange={onChange}
                    onBlur={onBlur}
                    ref={ref}
                    isRequired={isRequired}
                    isDisabled={isPending}
                    validationBehavior="aria"
                    isInvalid={invalid}
                    errorMessage={error?.message}
                    className={className}
                />
            )}
        />
    );
}
