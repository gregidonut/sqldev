import {createContext, useContext} from 'react';
import {type Control} from "react-hook-form";
type paymentMethod = 'Cash on Delivery' | 'Paid Online'

export type BasicFormSectionData = {
    orderNumber: string;
    customerName: string;
    email: string;
    mobileNumber: string;
    paymentMethod: paymentMethod
}
export const BasicFormSectionContext = createContext<Control<BasicFormSectionData> | null>(null);

export function useBasicFormSection() {
    return useContext(BasicFormSectionContext);
}