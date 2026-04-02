import React from 'react';
import {Controller} from "react-hook-form";
import {TextField} from "@/components/ui/TextField.tsx";
import {useBasicFormSection} from "../BasicFormSectionContext.ts";

export default function NameField() {
    const control = useBasicFormSection();
    if (!control) {
        throw new Error('useBasicFormSection must be used within a BasicFormSectionProvider');
    }
    return (
        <Controller
            control={control}
            name="customerName"
            rules={{required: 'Name is required.'}}
            render={({
                         field: {name, value, onChange, onBlur, ref},
                         fieldState: {invalid, error},
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
                    errorMessage={error?.message}/>
            )}/>
    )
}