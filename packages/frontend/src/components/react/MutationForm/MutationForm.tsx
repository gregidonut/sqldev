import React from "react";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";
import {
    FormProvider,
    useForm,
    type FieldValues,
    type UseFormProps,
} from "react-hook-form";
import { Form } from "@/components/ui/Form";
import type { FormProps } from "react-aria-components";
import { MutationFormStateContext } from "./MutationFormContext.ts";

type MutationFormOwnProps<
    TFieldValues extends FieldValues,
    TVariables,
    TData,
> = {
    formOptions: UseFormProps<TFieldValues>;
    mutationOptions: UseMutationOptions<TData, Error, TVariables>;
    toVariables?: (values: TFieldValues) => TVariables;
    onSuccess?: () => void;
    pendingFallback?: React.ReactNode;
    children: React.ReactNode;
};

export type MutationFormProps<
    TFieldValues extends FieldValues,
    TVariables,
    TData,
> = MutationFormOwnProps<TFieldValues, TVariables, TData> &
    Omit<FormProps, "onSubmit" | "validationBehavior">;

export function MutationForm<
    TFieldValues extends FieldValues,
    TVariables,
    TData,
>({
    formOptions,
    mutationOptions,
    toVariables,
    onSuccess,
    pendingFallback,
    children,
    ...formProps
}: MutationFormProps<TFieldValues, TVariables, TData>) {
    const methods = useForm<TFieldValues>(formOptions);
    const { mutate, isPending } = useMutation(mutationOptions);

    function resolveVariables(values: TFieldValues): TVariables {
        if (toVariables) {
            return toVariables(values);
        }
        return values as unknown as TVariables;
    }

    function onSubmit(values: TFieldValues) {
        mutate(resolveVariables(values), {
            onSuccess: () => {
                methods.reset();
                onSuccess?.();
            },
        });
    }

    if (isPending && pendingFallback) {
        return pendingFallback;
    }

    return (
        <FormProvider {...methods}>
            <MutationFormStateContext.Provider value={{ isPending }}>
                <Form
                    {...formProps}
                    validationBehavior="aria"
                    onSubmit={methods.handleSubmit(onSubmit)}
                >
                    {children}
                </Form>
            </MutationFormStateContext.Provider>
        </FormProvider>
    );
}
