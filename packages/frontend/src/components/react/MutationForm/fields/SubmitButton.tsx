import React from "react";
import { Button, type ButtonProps } from "@/components/ui/Button.tsx";
import { cy } from "@/utils/cy";

export type SubmitButtonProps = Omit<ButtonProps, "type"> & {
    dataCy?: string;
};

export function SubmitButton({
    dataCy,
    children,
    ...props
}: SubmitButtonProps) {
    return (
        <Button type="submit" {...(dataCy ? cy(dataCy) : {})} {...props}>
            {children}
        </Button>
    );
}
