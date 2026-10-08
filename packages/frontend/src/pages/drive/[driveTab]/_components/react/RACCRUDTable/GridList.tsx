import React from "react";
import {
    GridList as AriaGridList,
    GridListItem as AriaGridListItem,
    GridListHeader as AriaGridListHeader,
    Button,
    type GridListItemProps,
    type GridListProps,
} from "react-aria-components/GridList";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import { tv } from "tailwind-variants";
import { Checkbox } from "./Checkbox";
import { composeTailwindRenderProps, focusRing } from "./utils";
import { type HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function GridList<T>({ children, ...props }: GridListProps<T>) {
    let isHorizontal =
        (props as { orientation?: "horizontal" | "vertical" }).orientation ===
        "horizontal";
    return (
        <AriaGridList
            {...props}
            className={composeTailwindRenderProps(
                props.className,
                isHorizontal
                    ? "flex flex-row flex-nowrap overflow-x-auto relative w-full max-w-[500px] bg-drac-background text-drac-foreground border border-drac-selection rounded-lg font-sans empty:flex empty:items-center empty:justify-center empty:italic empty:text-sm"
                    : "overflow-auto w-[200px] relative bg-drac-background text-drac-foreground border border-drac-selection rounded-lg font-sans empty:flex empty:items-center empty:justify-center empty:italic empty:text-sm",
            )}
        >
            {children}
        </AriaGridList>
    );
}

const itemStyles = tv({
    extend: focusRing,
    base: [
        "relative flex gap-3 cursor-default select-none py-2 px-3 text-sm text-drac-foreground border-transparent -outline-offset-2",
        "[[data-orientation=vertical]_&]:border-t [[data-orientation=vertical]_&]:border-t-drac-selection [[data-orientation=vertical]_&]:first:border-t-0 [[data-orientation=vertical]_&]:first:rounded-t-lg [[data-orientation=vertical]_&]:last:rounded-b-lg",
        "[[data-orientation=horizontal]_&]:border-l [[data-orientation=horizontal]_&]:border-l-drac-selection [[data-orientation=horizontal]_&]:first:border-l-0 [[data-orientation=horizontal]_&]:first:rounded-s-lg [[data-orientation=horizontal]_&]:last:rounded-e-lg [[data-orientation=horizontal]_&]:flex-shrink-0",
    ].join(" "),
    variants: {
        isSelected: {
            false: "hover:bg-drac-selection/60 pressed:bg-drac-selection",
            true: [
                "bg-drac-purple/25 hover:bg-drac-purple/35 pressed:bg-drac-purple/35 z-20",
                "[[data-orientation=vertical]_&]:border-y-drac-purple",
                "[[data-orientation=horizontal]_&]:border-x-drac-purple",
            ].join(" "),
        },
        isDisabled: {
            true: "text-drac-comment forced-colors:text-[GrayText] z-10",
        },
    },
});

export function GridListItem({ children, ...props }: GridListItemProps) {
    let textValue = typeof children === "string" ? children : undefined;
    return (
        <AriaGridListItem
            textValue={textValue}
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    itemStyles({ ...renderProps, className }),
            )}
        >
            {composeRenderProps(
                children,
                (
                    children,
                    { selectionMode, selectionBehavior, allowsDragging },
                ) => (
                    <>
                        {/* Add elements for drag and drop and selection. */}
                        {allowsDragging && <Button slot="drag">≡</Button>}
                        {selectionMode !== "none" &&
                            selectionBehavior === "toggle" && (
                                <Checkbox slot="selection" />
                            )}
                        {children}
                    </>
                ),
            )}
        </AriaGridListItem>
    );
}

export function GridListHeader({
    children,
    ...props
}: HTMLAttributes<HTMLElement>) {
    return (
        <AriaGridListHeader
            {...props}
            className={twMerge(
                "text-sm font-semibold text-drac-foreground px-4 py-1 -mt-px z-10 bg-drac-selection/80 backdrop-blur-md supports-[-moz-appearance:none]:bg-drac-selection border-y border-y-drac-selection",
                props.className,
            )}
        >
            {children}
        </AriaGridListHeader>
    );
}
