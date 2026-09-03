import { Check } from "lucide-react";
import React from "react";
import {
    ListBox as AriaListBox,
    ListBoxItem as AriaListBoxItem,
    ListBoxSection,
    Header,
    Collection,
    type ListBoxProps as AriaListBoxProps,
    type ListBoxItemProps,
    type ListBoxSectionProps,
} from "react-aria-components/ListBox";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import { tv } from "tailwind-variants";
import { composeTailwindRenderProps, focusRing } from "./utils";

interface ListBoxProps<T> extends Omit<
    AriaListBoxProps<T>,
    "layout" | "orientation"
> {}

export function ListBox<T>({ children, ...props }: ListBoxProps<T>) {
    return (
        <AriaListBox
            {...props}
            className={composeTailwindRenderProps(
                props.className,
                "outline-0 p-1 w-[200px] bg-drac-background text-drac-foreground border border-drac-selection rounded-lg font-sans",
            )}
        >
            {children}
        </AriaListBox>
    );
}

export const itemStyles = tv({
    extend: focusRing,
    base: "group relative flex items-center gap-8 cursor-default select-none py-1.5 px-2.5 rounded-md will-change-transform text-sm forced-color-adjust-none",
    variants: {
        isSelected: {
            false: "text-drac-foreground hover:bg-drac-selection pressed:bg-drac-current-line -outline-offset-2",
            true: "bg-drac-purple text-drac-background forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] [&:has(+[data-selected])]:rounded-b-none [&+[data-selected]]:rounded-t-none -outline-offset-4 outline-drac-background forced-colors:outline-[HighlightText]",
        },
        isDisabled: {
            true: "text-drac-comment forced-colors:text-[GrayText]",
        },
    },
});

export function ListBoxItem(props: ListBoxItemProps) {
    let textValue =
        props.textValue ||
        (typeof props.children === "string" ? props.children : undefined);
    return (
        <AriaListBoxItem
            {...props}
            textValue={textValue}
            className={itemStyles}
        >
            {composeRenderProps(props.children, (children) => (
                <>
                    {children}
                    <div className="absolute left-4 right-4 bottom-0 h-px bg-drac-background/20 forced-colors:bg-[HighlightText] hidden [.group[data-selected]:has(+[data-selected])_&]:block" />
                </>
            ))}
        </AriaListBoxItem>
    );
}

export const dropdownItemStyles = tv({
    base: "group flex items-center gap-4 cursor-default select-none py-2 pl-3 pr-3 selected:pr-1 rounded-lg outline outline-0 text-sm forced-color-adjust-none no-underline [&[href]]:cursor-pointer [-webkit-tap-highlight-color:transparent]",
    variants: {
        isDisabled: {
            false: "text-drac-foreground",
            true: "text-drac-comment forced-colors:text-[GrayText]",
        },
        isPressed: {
            true: "bg-drac-current-line",
        },
        isFocused: {
            true: "bg-drac-purple text-drac-background forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]",
        },
    },
    compoundVariants: [
        {
            isFocused: false,
            isOpen: true,
            className: "bg-drac-selection",
        },
    ],
});

export function DropdownItem(props: ListBoxItemProps) {
    let textValue =
        props.textValue ||
        (typeof props.children === "string" ? props.children : undefined);
    return (
        <AriaListBoxItem
            {...props}
            textValue={textValue}
            className={dropdownItemStyles}
        >
            {composeRenderProps(props.children, (children, { isSelected }) => (
                <>
                    <span className="flex items-center flex-1 gap-2 font-normal truncate group-selected:font-semibold">
                        {children}
                    </span>
                    <span className="flex items-center w-5">
                        {isSelected && <Check className="w-4 h-4" />}
                    </span>
                </>
            ))}
        </AriaListBoxItem>
    );
}

export interface DropdownSectionProps<T> extends ListBoxSectionProps<T> {
    title?: string;
    items?: any;
}

export function DropdownSection<T>(props: DropdownSectionProps<T>) {
    return (
        <ListBoxSection className="first:-mt-[5px] after:content-[''] after:block after:h-[5px] last:after:hidden">
            <Header className="text-sm font-semibold text-drac-foreground px-4 py-1 truncate sticky -top-[5px] -mt-px -mx-1 z-10 bg-drac-selection/80 backdrop-blur-md supports-[-moz-appearance:none]:bg-drac-selection border-y border-y-drac-selection [&+*]:mt-1">
                {props.title}
            </Header>
            <Collection items={props.items}>{props.children}</Collection>
        </ListBoxSection>
    );
}
