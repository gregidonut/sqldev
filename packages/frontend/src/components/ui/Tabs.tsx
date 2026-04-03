import React from "react";
import {
    Tab as RACTab,
    TabList as RACTabList,
    TabPanels as RACTabPanels,
    TabPanel as RACTabPanel,
    Tabs as RACTabs,
    SelectionIndicator,
    type TabListProps,
    type TabPanelProps,
    type TabPanelsProps,
    type TabProps,
    type TabsProps,
    composeRenderProps,
} from "react-aria-components";
import { tv } from "tailwind-variants";
import { focusRing } from "@/lib/react-aria-utils";
import { twMerge } from "tailwind-merge";

const tabsStyles = tv({
    base: "flex gap-4 font-sans max-w-full",
    variants: {
        orientation: {
            horizontal: "flex-col",
            vertical: "flex-row",
        },
    },
});

export function Tabs(props: TabsProps) {
    return (
        <RACTabs
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    tabsStyles({ ...renderProps, className }),
            )}
        />
    );
}

const tabListStyles = tv({
    base: "flex max-w-full p-1 -m-1 overflow-x-auto overflow-y-clip [scrollbar-width:none]",
    variants: {
        orientation: {
            horizontal: "flex-row",
            vertical: "flex-col items-start",
        },
    },
});

export function TabList<T extends object>(props: TabListProps<T>) {
    return (
        <RACTabList
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    tabListStyles({ ...renderProps, className }),
            )}
        />
    );
}

const tabProps = tv({
    extend: focusRing,
    base:
        "group relative flex items-center cursor-pointer" +
        " rounded-top-sm px-3 py-1.5 text-sm font-medium " +
        "transition forced-color-adjust-none [-webkit-tap-highlight-color:transparent]",
    variants: {
        isDisabled: {
            true:
                "cursor-default " +
                "z-5 " +
                "bg-drac-comment " +
                "rounded-t-sm " +
                // "group-disabled:bg-neutral-400 group-disabled:mix-blend-normal group-disabled:dark:bg-neutral-600 group-disabled:-z-1 " +
                "motion-safe:transition-[translate,width,height] ",
        },
    },
});

export function Tab(props: TabProps) {
    return (
        <RACTab
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    tabProps({ ...renderProps, className }),
            )}
        >
            {composeRenderProps(props.children, (children) => (
                <>
                    <span className="z-10 text-drac-foreground">
                        {children}
                    </span>
                    <SelectionIndicator
                        className={
                            "absolute top-0 left-0 w-full h-full " +
                            "z-5 " +
                            "bg-drac-comment " +
                            "rounded-t-sm " +
                            // "group-disabled:bg-neutral-400 group-disabled:mix-blend-normal group-disabled:dark:bg-neutral-600 group-disabled:-z-1 " +
                            "motion-safe:transition-[translate,width,height] "
                        }
                    />
                </>
            ))}
        </RACTab>
    );
}

export function TabPanels<T extends object>(props: TabPanelsProps<T>) {
    return (
        <RACTabPanels
            {...props}
            className={twMerge(
                "relative h-(--tab-panel-height) motion-safe:transition-[height] overflow-clip",
                props.className,
            )}
        />
    );
}

const tabPanelStyles = tv({
    extend: focusRing,
    base: "flex-1 box-border p-4 text-sm text-neutral-900 dark:text-neutral-100 transition entering:opacity-0 exiting:opacity-0 exiting:absolute exiting:top-0 exiting:left-0 exiting:w-full",
});

export function TabPanel(props: TabPanelProps) {
    return (
        <RACTabPanel
            {...props}
            className={composeRenderProps(
                props.className,
                (className, renderProps) =>
                    tabPanelStyles({ ...renderProps, className }),
            )}
        />
    );
}
