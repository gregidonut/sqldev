import React from "react";
import { Button, type ButtonProps } from "@/components/ui/Button.tsx";
import { cy } from "@/utils/cy";
import { useMutationFormState } from "../MutationFormContext.ts";

export type SubmitButtonProps = Omit<ButtonProps, "type"> & {
    dataCy?: string;
};

export function SubmitButton({
    dataCy,
    children,
    isDisabled,
    ...props
}: SubmitButtonProps) {
    const { isPending } = useMutationFormState();

    return (
        <Button
            type="submit"
            {...props}
            {...(dataCy ? cy(dataCy) : {})}
            isPending={isPending}
            isDisabled={isPending || isDisabled}
        >
            {children}
        </Button>
    );
}
