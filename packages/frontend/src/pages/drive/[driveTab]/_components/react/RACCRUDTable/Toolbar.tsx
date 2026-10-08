import React from "react";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import {
    Toolbar as RACToolbar,
    type ToolbarProps,
} from "react-aria-components/Toolbar";
import { tv } from "tailwind-variants";

const styles = tv({
    base: "flex min-w-0 flex-wrap gap-2",
    variants: {
        orientation: {
            horizontal: "flex-row items-center",
            vertical: "flex-col items-start",
        },
    },
});

export function Toolbar(props: ToolbarProps) {
    return (
        <RACToolbar
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    styles({ ...renderProps, className }),
            )}
        />
    );
}
