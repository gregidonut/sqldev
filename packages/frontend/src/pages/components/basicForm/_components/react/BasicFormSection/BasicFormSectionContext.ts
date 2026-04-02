import React, {createContext, useContext} from 'react';
import {type Control} from "react-hook-form";
import {type BasicFormSectionData} from "./BasicFormSectionData";

export const BasicFormSectionContext = createContext<Control<BasicFormSectionData> | null>(null);

export function useBasicFormSection() {
    return useContext(BasicFormSectionContext);
}