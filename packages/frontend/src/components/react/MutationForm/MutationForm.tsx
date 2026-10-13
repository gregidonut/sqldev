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
    // isPending updates on the next render, so Enter-then-click in the same
    // turn still reaches onSubmit twice. The ref closes that gap.
    const inFlightRef = React.useRef(false);

    function resolveVariables(values: TFieldValues): TVariables {
        if (toVariables) {
            return toVariables(values);
        }
        return values as unknown as TVariables;
    }

    function onSubmit(values: TFieldValues) {
        if (inFlightRef.current) {
            return;
        }
        inFlightRef.current = true;
        mutate(resolveVariables(values), {
            onSuccess: () => {
                methods.reset();
                onSuccess?.();
            },
            onSettled: () => {
                inFlightRef.current = false;
            },
        });
    }

    // The single guarded submission entry point. RHF's handleSubmit runs
    // validation and only calls onSubmit with valid values; onSubmit holds the
    // in-flight guard. Native submit, the submit button, and the editor
    // keyboard shortcut all funnel through this one function.
    const guardedSubmit = React.useMemo(
        () => methods.handleSubmit(onSubmit),
        // handleSubmit is stable for a given form; onSubmit closes over stable
        // refs and callbacks. Recreating on each render is also safe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [methods],
    );

    const submit = React.useCallback(() => {
        void guardedSubmit();
    }, [guardedSubmit]);

    const contextValue = React.useMemo(
        () => ({ isPending, submit }),
        [isPending, submit],
    );

    if (isPending && pendingFallback) {
        return pendingFallback;
    }

    return (
        <FormProvider {...methods}>
            <MutationFormStateContext.Provider value={contextValue}>
                <Form
                    {...formProps}
                    validationBehavior="aria"
                    onSubmit={guardedSubmit}
                >
                    {children}
                </Form>
            </MutationFormStateContext.Provider>
        </FormProvider>
    );
}
