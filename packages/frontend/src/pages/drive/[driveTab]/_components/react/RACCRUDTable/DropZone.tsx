import React from "react";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import {
    type DropZoneProps,
    DropZone as RACDropZone,
    Text,
} from "react-aria-components/DropZone";
import { tv } from "tailwind-variants";

const dropZone = tv({
    base: "flex items-center justify-center p-8 min-h-24 w-[30%] font-sans text-base text-balance text-center rounded-lg border border-1 border-drac-selection bg-drac-background text-drac-foreground",
    variants: {
        isFocusVisible: {
            true: "outline outline-2 -outline-offset-1 outline-drac-cyan forced-colors:outline-[Highlight]",
        },
        isDropTarget: {
            true: "bg-drac-selection outline outline-2 -outline-offset-1 outline-drac-cyan forced-colors:outline-[Highlight]",
        },
        isDisabled: {
            true: "border-drac-selection/60 text-drac-comment",
        },
    },
});

export function DropZone(props: DropZoneProps) {
    return (
        <RACDropZone
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    dropZone({ ...renderProps, className }),
            )}
        />
    );
}

export { Text };
