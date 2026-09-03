import React from "react";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import {
    Button as RACButton,
    type ButtonProps as RACButtonProps,
} from "react-aria-components/Button";
import { tv } from "tailwind-variants";
import { focusRing } from "./utils";

export interface ButtonProps extends RACButtonProps {
    /** @default 'primary' */
    variant?: "primary" | "secondary" | "destructive" | "icon";
}

let button = tv({
    extend: focusRing,
    base: "relative inline-flex items-center border-0 font-sans text-sm text-center transition rounded-md cursor-default p-1 flex items-center justify-center text-drac-comment bg-transparent hover:bg-drac-selection pressed:bg-drac-current-line disabled:bg-transparent [-webkit-tap-highlight-color:transparent]",
    variants: {
        isDisabled: {
            true: "bg-transparent text-drac-comment/60 forced-colors:text-[GrayText]",
        },
    },
});

export function FieldButton(props: ButtonProps) {
    return (
        <RACButton
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    button({ ...renderProps, className }),
            )}
        >
            {props.children}
        </RACButton>
    );
}
