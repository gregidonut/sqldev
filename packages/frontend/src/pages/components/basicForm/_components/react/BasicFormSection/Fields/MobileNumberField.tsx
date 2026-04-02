import React from 'react';
import {Controller} from "react-hook-form";
import {TextField} from "@/components/ui/TextField.tsx";
import {useBasicFormSection} from "../BasicFormSectionContext.ts";


export default function MobileNumberField() {
    const control = useBasicFormSection();
    if (!control) {
        console.error('useBasicFormSection must be used within a BasicFormSectionProvider');
        return null
    }
    return (
    <Controller
        control={control}
        name="mobileNumber"
        rules={{
            required: 'mobileNumber is required.',
            minLength: {value: 10, message: 'Mobile number must be at least 10 digits'},
            maxLength: {value: 10, message: 'Mobile number must be at least 10 digits'}
        }}
        render={function ({
                              field: {name, value, onChange, onBlur, ref},
                              fieldState: {invalid, error},
                          }) {
            return (
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
            )
        }}/>
    )
}