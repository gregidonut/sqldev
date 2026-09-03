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
    variant?: "primary" | "secondary" | "destructive" | "quiet";
}

let button = tv({
    extend: focusRing,
    base: "relative inline-flex items-center justify-center gap-2 border border-transparent h-9 box-border px-3.5 py-0 [&:has(>svg:only-child)]:px-0 [&:has(>svg:only-child)]:h-8 [&:has(>svg:only-child)]:w-8 font-sans text-sm text-center transition rounded-lg cursor-default [-webkit-tap-highlight-color:transparent]",
    variants: {
        variant: {
            primary:
                "bg-drac-purple hover:bg-drac-purple/85 pressed:bg-drac-purple/70 text-drac-background",
            secondary:
                "border-drac-comment/50 bg-drac-selection hover:bg-drac-current-line pressed:bg-drac-comment text-drac-foreground",
            destructive:
                "bg-drac-red hover:bg-drac-red/85 pressed:bg-drac-red/70 text-drac-background",
            quiet: "border-0 bg-transparent hover:bg-drac-selection pressed:bg-drac-current-line text-drac-foreground",
        },
        isDisabled: {
            true: "border-transparent bg-drac-selection/50 text-drac-comment forced-colors:text-[GrayText]",
        },
        isPending: {
            true: "text-transparent",
        },
    },
    defaultVariants: {
        variant: "primary",
    },
    compoundVariants: [
        {
            variant: "quiet",
            isDisabled: true,
            class: "bg-transparent dark:bg-transparent",
        },
    ],
});

export function Button(props: ButtonProps) {
    return (
        <RACButton
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    button({
                        ...renderProps,
                        variant: props.variant,
                        className,
                    }),
            )}
        >
            {composeRenderProps(props.children, (children, { isPending }) => (
                <>
                    {children}
                    {isPending && (
                        <span
                            aria-hidden
                            className="flex absolute inset-0 justify-center items-center"
                        >
                            <svg
                                className="w-4 h-4 animate-spin"
                                viewBox="0 0 24 24"
                                stroke={
                                    props.variant === "secondary" ||
                                    props.variant === "quiet"
                                        ? "var(--color-drac-foreground)"
                                        : "var(--color-drac-background)"
                                }
                            >
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    strokeWidth="4"
                                    fill="none"
                                    className="opacity-25"
                                />
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    fill="none"
                                    pathLength="100"
                                    strokeDasharray="60 140"
                                    strokeDashoffset="0"
                                />
                            </svg>
                        </span>
                    )}
                </>
            ))}
        </RACButton>
    );
}
