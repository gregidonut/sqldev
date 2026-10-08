import React from "react";
import { DialogTrigger } from "react-aria-components/Dialog";
import { TooltipTrigger } from "react-aria-components/Tooltip";
import type { Selection } from "react-aria-components/Table";
import {
    LayoutGridIcon,
    PlusIcon,
    Rows3Icon,
    SlidersHorizontalIcon,
    TrashIcon,
} from "lucide-react";
import { Button } from "../Button.tsx";
import { Menu, MenuItem, MenuTrigger } from "../Menu.tsx";
import { Modal } from "../Modal.tsx";
import { Toolbar } from "../Toolbar.tsx";
import { Tooltip } from "../Tooltip.tsx";
import { TOGGLEABLE_STORAGE_COLUMNS } from "./StorageTable.tsx";
import { UploadForm } from "../forms/UploadForm.tsx";
import {
    STORAGE_VIEWS,
    toStorageView,
    type StorageView,
} from "./store/storageTableStore.ts";
import { cy } from "@/utils/cy";

const VIEW_ICONS = {
    detailed: Rows3Icon,
    tiles: LayoutGridIcon,
} as const satisfies Record<StorageView, typeof Rows3Icon>;

interface StorageToolbarProps {
    canModify: boolean;
    selectedCount: number;
    isDeleting: boolean;
    view: StorageView;
    visibleColumns: Selection;
    bucketName: string;
    userId: string;
    onDeleteSelected: () => void;
    onViewChange: (view: StorageView) => void;
    onVisibleColumnsChange: (selection: Selection) => void;
}

export function StorageToolbar(props: StorageToolbarProps): React.ReactNode {
    const {
        canModify,
        selectedCount,
        isDeleting,
        view,
        visibleColumns,
        bucketName,
        userId,
        onDeleteSelected,
        onViewChange,
        onVisibleColumnsChange,
    } = props;

    return (
        <Toolbar
            {...cy("dStorage_toolbar")}
            aria-label="Storage actions"
            className="w-full"
        >
            {canModify && (
                <DialogTrigger>
                    <TooltipTrigger>
                        <Button
                            {...cy("dStorage_upload")}
                            aria-label="Upload a file"
                            variant="secondary"
                            className="h-9! w-9! shrink-0"
                        >
                            <PlusIcon aria-hidden className="block h-5 w-5" />
                        </Button>
                        <Tooltip>Upload a file</Tooltip>
                    </TooltipTrigger>
                    <Modal>
                        <UploadForm bucketName={bucketName} userId={userId} />
                    </Modal>
                </DialogTrigger>
            )}

            {canModify && (
                <Button
                    {...cy("dStorage_delete_selected")}
                    variant="destructive"
                    isDisabled={selectedCount === 0 || isDeleting}
                    onPress={onDeleteSelected}
                    className="h-9! w-auto! shrink-0 whitespace-nowrap px-3.5!"
                >
                    <TrashIcon aria-hidden className="h-4 w-4" />
                    Delete selected
                </Button>
            )}

            <span
                {...cy("dStorage_selected_count")}
                aria-live="polite"
                className="whitespace-nowrap font-sans text-xs text-drac-comment"
            >
                {selectedCount} selected
            </span>

            <div className="ms-auto flex flex-wrap items-center gap-2">
                <MenuTrigger>
                    <TooltipTrigger>
                        <Button
                            aria-label="Columns"
                            variant="secondary"
                            className="h-9! w-9! shrink-0"
                        >
                            <SlidersHorizontalIcon
                                aria-hidden
                                className="block h-5 w-5"
                            />
                        </Button>
                        <Tooltip>Columns</Tooltip>
                    </TooltipTrigger>
                    <Menu
                        selectionMode="multiple"
                        selectedKeys={visibleColumns}
                        onSelectionChange={onVisibleColumnsChange}
                        disallowEmptySelection
                        items={TOGGLEABLE_STORAGE_COLUMNS}
                    >
                        {(column) => (
                            <MenuItem id={column.id}>{column.label}</MenuItem>
                        )}
                    </Menu>
                </MenuTrigger>

                <MenuTrigger>
                    <TooltipTrigger>
                        <Button
                            {...cy("dStorage_view_options")}
                            aria-label="View options"
                            variant="secondary"
                            className="h-9! shrink-0 px-2.5"
                        >
                            <LayoutGridIcon
                                aria-hidden
                                className="block h-5 w-5"
                            />
                            <span className="hidden sm:inline">
                                View options
                            </span>
                        </Button>
                        <Tooltip>View options</Tooltip>
                    </TooltipTrigger>
                    <Menu
                        selectionMode="single"
                        selectedKeys={[view]}
                        disallowEmptySelection
                        onSelectionChange={function (selection) {
                            const next = toStorageView(selection);
                            if (next) {
                                onViewChange(next);
                            }
                        }}
                    >
                        {STORAGE_VIEWS.map(function (option) {
                            const Icon = VIEW_ICONS[option];
                            return (
                                <MenuItem
                                    {...cy(`dStorage_view_${option}`)}
                                    key={option}
                                    id={option}
                                    textValue={viewLabel(option)}
                                >
                                    <Icon aria-hidden className="h-4 w-4" />
                                    {viewLabel(option)}
                                </MenuItem>
                            );
                        })}
                    </Menu>
                </MenuTrigger>
            </div>
        </Toolbar>
    );
}

function viewLabel(view: StorageView): string {
    switch (view) {
        case "detailed":
            return "Detailed";
        case "tiles":
            return "Tiles";
        default:
            return assertUnreachable(view);
    }
}

function assertUnreachable(value: never): never {
    throw new Error(`Unexpected view: ${String(value)}`);
}
