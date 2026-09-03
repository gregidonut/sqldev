import { ArrowUp, ChevronRight } from "lucide-react";
import React from "react";
import {
    Cell as AriaCell,
    Column as AriaColumn,
    Row as AriaRow,
    Table as AriaTable,
    TableHeader as AriaTableHeader,
    TableBody as AriaTableBody,
    Button,
    type CellProps,
    Collection,
    type ColumnProps,
    ColumnResizer,
    ResizableTableContainer,
    type RowProps,
    type TableHeaderProps,
    type TableProps as AriaTableProps,
    useTableOptions,
    type TableBodyProps,
    TableFooter as AriaTableFooter,
    type TableFooterProps,
} from "react-aria-components/Table";
import { Group } from "react-aria-components/Group";
import { composeRenderProps } from "react-aria-components/composeRenderProps";
import { twMerge } from "tailwind-merge";
import { tv } from "tailwind-variants";
import { Checkbox } from "./Checkbox";
import { composeTailwindRenderProps, focusRing } from "./utils";

interface TableProps extends Omit<AriaTableProps, "className"> {
    className?: string;
}

export function Table(props: TableProps) {
    return (
        <ResizableTableContainer
            onScroll={props.onScroll}
            className={twMerge(
                "w-full min-w-0 max-h-[320px] overflow-auto scroll-pt-[2.281rem] relative bg-drac-background box-border border border-drac-selection rounded-lg font-sans",
                props.className,
            )}
        >
            <AriaTable
                {...props}
                className="border-separate border-spacing-0 box-border overflow-hidden has-[>[data-empty]]:h-full"
            />
        </ResizableTableContainer>
    );
}

const columnStyles = tv({
    extend: focusRing,
    base: "px-2 h-5 box-border flex-1 flex gap-1 items-center overflow-hidden",
});

const resizerStyles = tv({
    extend: focusRing,
    base: "w-px px-[8px] translate-x-[8px] box-content py-1 h-5 bg-clip-content bg-drac-comment forced-colors:bg-[ButtonBorder] cursor-col-resize rounded-xs resizing:bg-drac-cyan forced-colors:resizing:bg-[Highlight] resizing:w-[2px] resizing:pl-[7px] -outline-offset-2",
});

export function Column(props: ColumnProps) {
    return (
        <AriaColumn
            {...props}
            className={composeTailwindRenderProps(
                props.className,
                "box-border h-1 [&:hover]:z-20 focus-within:z-20 text-start text-sm font-semibold text-drac-foreground cursor-default",
            )}
        >
            {composeRenderProps(
                props.children,
                (children, { allowsSorting, sortDirection }) => (
                    <div className="flex items-center">
                        <Group
                            role="presentation"
                            tabIndex={-1}
                            className={columnStyles}
                        >
                            <span className="truncate">{children}</span>
                            {allowsSorting && (
                                <span
                                    className={`w-4 h-4 flex items-center justify-center transition ${
                                        sortDirection === "descending"
                                            ? "rotate-180"
                                            : ""
                                    }`}
                                >
                                    {sortDirection && (
                                        <ArrowUp
                                            aria-hidden
                                            className="w-4 h-4 text-drac-cyan forced-colors:text-[ButtonText]"
                                        />
                                    )}
                                </span>
                            )}
                        </Group>
                        {!props.width && (
                            <ColumnResizer className={resizerStyles} />
                        )}
                    </div>
                ),
            )}
        </AriaColumn>
    );
}

export function TableHeader<T>(props: TableHeaderProps<T>) {
    let { selectionBehavior, selectionMode, allowsDragging } =
        useTableOptions();

    return (
        <AriaTableHeader
            {...props}
            className={composeTailwindRenderProps(
                props.className,
                "sticky top-0 z-10 bg-drac-selection/80 backdrop-blur-md supports-[-moz-appearance:none]:bg-drac-selection forced-colors:bg-[Canvas] rounded-t-lg border-b border-b-drac-selection",
            )}
        >
            {/* Add extra columns for drag and drop and selection. */}
            {allowsDragging && <Column />}
            {selectionBehavior === "toggle" && (
                <AriaColumn
                    width={36}
                    minWidth={36}
                    className="box-border p-2 text-sm font-semibold cursor-default text-start"
                >
                    {selectionMode === "multiple" && (
                        <Checkbox slot="selection" />
                    )}
                </AriaColumn>
            )}
            <Collection items={props.columns}>{props.children}</Collection>
        </AriaTableHeader>
    );
}

export function TableBody<T>(props: TableBodyProps<T>) {
    return (
        <AriaTableBody
            {...props}
            className="empty:italic empty:text-center empty:text-sm"
        />
    );
}

export function TableFooter<T>(props: TableFooterProps<T>) {
    return (
        <AriaTableFooter {...props} className="bg-drac-selection font-bold" />
    );
}

const rowStyles = tv({
    extend: focusRing,
    base: "group/row relative cursor-default select-none -outline-offset-2 text-drac-foreground disabled:text-drac-comment text-sm hover:bg-drac-selection/60 pressed:bg-drac-selection selected:bg-drac-purple/25 selected:hover:bg-drac-purple/35 selected:pressed:bg-drac-purple/35 last:rounded-b-lg",
});

export function Row<T>({ id, columns, children, ...otherProps }: RowProps<T>) {
    let { selectionBehavior, allowsDragging } = useTableOptions();

    return (
        <AriaRow id={id} {...otherProps} className={rowStyles}>
            {allowsDragging && (
                <Cell>
                    <Button slot="drag">≡</Button>
                </Cell>
            )}
            {selectionBehavior === "toggle" && (
                <Cell>
                    <Checkbox slot="selection" />
                </Cell>
            )}
            <Collection items={columns}>{children}</Collection>
        </AriaRow>
    );
}

const cellStyles = tv({
    extend: focusRing,
    base: "box-border [-webkit-tap-highlight-color:transparent] border-b border-b-drac-selection group-last/row:border-b-0 [--selected-border:var(--color-drac-purple)] group-selected/row:border-(--selected-border) [:is(:has(+[data-selected])_*)]:border-(--selected-border) p-2 truncate -outline-offset-2 group-last/row:first:rounded-bl-lg group-last/row:last:rounded-br-lg",
});

const expandButton = tv({
    extend: focusRing,
    base: "border-0 p-0 pr-1 bg-transparent shrink-0 align-middle cursor-default [-webkit-tap-highlight-color:transparent]",
    variants: {
        isDisabled: {
            true: "text-drac-comment forced-colors:text-[GrayText]",
        },
    },
});

const chevron = tv({
    base: "w-4.5 h-4.5 text-drac-comment transition-transform duration-200 ease-in-out",
    variants: {
        isExpanded: {
            true: "transform rotate-90",
        },
        isDisabled: {
            true: "text-drac-comment/60 forced-colors:text-[GrayText]",
        },
    },
});

export function Cell(props: CellProps) {
    return (
        <AriaCell
            {...props}
            className={cellStyles}
            style={({ hasChildItems, isTreeColumn, level }) => ({
                paddingInlineStart: isTreeColumn
                    ? 4 + (hasChildItems ? 0 : 20) + (level - 1) * 16
                    : undefined,
            })}
        >
            {composeRenderProps(
                props.children,
                (
                    children,
                    { hasChildItems, isTreeColumn, isExpanded, isDisabled },
                ) => (
                    <>
                        {hasChildItems && isTreeColumn && (
                            <Button
                                slot="chevron"
                                className={expandButton({ isDisabled })}
                            >
                                <ChevronRight
                                    aria-hidden
                                    className={chevron({
                                        isExpanded,
                                        isDisabled,
                                    })}
                                />
                            </Button>
                        )}
                        {children}
                    </>
                ),
            )}
        </AriaCell>
    );
}
