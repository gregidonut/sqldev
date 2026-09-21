import React from "react";
import {
    Controller,
    useFormContext,
    type ControllerProps,
    type FieldValues,
    type Path,
} from "react-hook-form";
import { FieldError, Label, TextArea, TextField } from "react-aria-components";
import { cy } from "@/utils/cy";
import { textValue } from "./textValue.ts";

const defaultTextAreaClassName =
    "w-full resize-none rounded-sm border-drac-comment px-3 py-2 bg-drac-background field-sizing-content";

export interface TextAreaFieldProps<TFieldValues extends FieldValues> {
    name: Path<TFieldValues>;
    rules?: ControllerProps<TFieldValues, Path<TFieldValues>>["rules"];
    label?: string;
    isRequired?: boolean;
    className?: string;
    textAreaClassName?: string;
    rows?: number;
    autoFocus?: boolean;
    stopArrowKeyPropagation?: boolean;
    dataCy?: string;
}

export function TextAreaField<TFieldValues extends FieldValues>({
    name,
    rules,
    label,
    isRequired,
    className,
    textAreaClassName = defaultTextAreaClassName,
    rows = 4,
    autoFocus,
    stopArrowKeyPropagation,
    dataCy,
}: TextAreaFieldProps<TFieldValues>) {
    const { control } = useFormContext<TFieldValues>();

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
                    name={fieldName}
                    value={textValue(value)}
                    onChange={onChange}
                    onBlur={onBlur}
                    ref={ref}
                    isRequired={isRequired}
                    autoFocus={autoFocus}
                    validationBehavior="aria"
                    isInvalid={invalid}
                    className={className}
                    {...(dataCy ? cy(dataCy) : {})}
                >
                    <Label>{label ?? fieldName}</Label>
                    <TextArea
                        rows={rows}
                        className={textAreaClassName}
                        onKeyDown={
                            stopArrowKeyPropagation
                                ? (event) => {
                                      if (event.key.startsWith("Arrow")) {
                                          event.stopPropagation();
                                      }
                                  }
                                : undefined
                        }
                    />
                    <FieldError className="text-drac-red">
                        {error?.message}
                    </FieldError>
                </TextField>
            )}
        />
    );
}
