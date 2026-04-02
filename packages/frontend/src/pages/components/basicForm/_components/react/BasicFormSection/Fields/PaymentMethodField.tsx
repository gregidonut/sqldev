import React from 'react';
import {Controller} from "react-hook-form";
import {Select, SelectItem} from '@/components/ui/Select.tsx';
import {useBasicFormSection} from "../BasicFormSectionContext.ts";

export default function PaymentMethodField() {
    const control = useBasicFormSection();
    if (!control) {
        throw new Error('useBasicFormSection must be used within a BasicFormSectionProvider');
    }
    return (
        <Controller
            control={control}
            name="paymentMethod"
            rules={{required: 'paymentMethod is required.'}}
            render={({
                         field: {name, value, onChange, onBlur, ref},
                         fieldState: {invalid, error},
                     }) => (
                    <Select
                        label="paymentMethod"
                        name={name}
                        value={value}
                        onChange={onChange}
                        onBlur={onBlur}
                        ref={ref}
                        isRequired
                        validationBehavior="aria"
                        isInvalid={invalid}
                        errorMessage={error?.message}
                    >
                        <SelectItem id="Cash on Delivery">Cash on Delivery</SelectItem>
                        <SelectItem id="Paid Online">Paid Online</SelectItem>
                    </Select>
                )}/>
    )
}