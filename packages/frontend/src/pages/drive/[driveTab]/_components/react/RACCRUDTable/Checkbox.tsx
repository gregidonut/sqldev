import { Check, Minus } from "lucide-react";
import React from "react";
import {
    CheckboxField,
    CheckboxButton,
    type CheckboxFieldProps,
    type ValidationResult,
} from "react-aria-components/Checkbox";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import { tv } from "tailwind-variants";
import { focusRing } from "./utils";
import { Description, FieldError } from "./Field";

const checkboxStyles = tv({
    base: "flex gap-2 items-center group font-sans text-sm transition relative [-webkit-tap-highlight-color:transparent]",
    variants: {
        isDisabled: {
            false: "text-drac-foreground",
            true: "text-drac-comment forced-colors:text-[GrayText]",
        },
    },
});

const boxStyles = tv({
    extend: focusRing,
    base: "w-4.5 h-4.5 box-border shrink-0 rounded-sm flex items-center justify-center border transition",
    variants: {
        isSelected: {
            false: "bg-drac-background border-(--color) [--color:var(--color-drac-comment)] group-pressed:[--color:var(--color-drac-cyan)]",
            true: "bg-(--color) border-(--color) [--color:var(--color-drac-purple)] group-pressed:[--color:var(--color-drac-pink)] forced-colors:[--color:Highlight]!",
        },
        isInvalid: {
            true: "[--color:var(--color-drac-red)] forced-colors:[--color:Mark]! group-pressed:[--color:var(--color-drac-red)]",
        },
        isDisabled: {
            true: "[--color:var(--color-drac-selection)] forced-colors:[--color:GrayText]!",
        },
    },
});

const iconStyles =
    "w-3.5 h-3.5 text-drac-background group-disabled:text-drac-comment forced-colors:text-[HighlightText] pointer-events-none";

interface CheckboxProps extends CheckboxFieldProps {
    children?: React.ReactNode;
    description?: string;
    errorMessage?: string | ((validation: ValidationResult) => string);
}

export function Checkbox(props: CheckboxProps) {
    return (
        <CheckboxField {...props} className="flex flex-col gap-1 group">
            <CheckboxButton
                className={composeRenderProps(
                    props.className,
                    (className, renderProps) =>
                        checkboxStyles({ ...renderProps, className }),
                )}
            >
                {composeRenderProps(
                    props.children,
                    (
                        children,
                        { isSelected, isIndeterminate, ...renderProps },
                    ) => (
                        <>
                            <div
                                className={boxStyles({
                                    isSelected: isSelected || isIndeterminate,
                                    ...renderProps,
                                })}
                            >
                                {isIndeterminate ? (
                                    <Minus aria-hidden className={iconStyles} />
                                ) : isSelected ? (
                                    <Check aria-hidden className={iconStyles} />
                                ) : null}
                            </div>
                            {children}
                        </>
                    ),
                )}
            </CheckboxButton>
            {props.description && (
                <Description className="ms-6.5">
                    {props.description}
                </Description>
            )}
            <FieldError className="ms-6.5">{props.errorMessage}</FieldError>
        </CheckboxField>
    );
}
