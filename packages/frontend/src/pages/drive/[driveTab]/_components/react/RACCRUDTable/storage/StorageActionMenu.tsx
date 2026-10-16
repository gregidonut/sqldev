import React, { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    CopyIcon,
    DownloadIcon,
    GlobeIcon,
    LockIcon,
    MoreHorizontal,
    TrashIcon,
} from "lucide-react";
import { Button } from "../Button.tsx";
import { Menu, MenuItem, MenuTrigger } from "../Menu.tsx";
import { toErrorMessage } from "./storageDisplay.tsx";
import createDownloadGetQueryOptions from "../queryOptions/createDownloadGet.ts";
import type { StorageRow } from "../queryOptions/types.ts";
import {
    visibilityMenuLabel,
    type StorageVisibilityMenu,
} from "./visibility/visibilityAction.ts";
import { cy } from "@/utils/cy";

interface StorageActionMenuProps {
    item: StorageRow;
    bucketName: string;
    userId: string;
    canDelete: boolean;
    onCopy: (item: StorageRow) => void;
    onDelete: (item: StorageRow) => void;
    onError: (message: string) => void;
    /** Present only where the viewer may change visibility. */
    visibility?: StorageVisibilityMenu;
}

export function StorageActionMenu({
    item,
    bucketName,
    userId,
    canDelete,
    onCopy,
    onDelete,
    onError,
    visibility,
}: StorageActionMenuProps) {
    const queryClient = useQueryClient();
    const [isDownloading, setIsDownloading] = useState(false);
    // The shared Button does not take a ref, so find the trigger from a wrapper
    // that does not affect layout.
    const wrapperRef = useRef<HTMLSpanElement | null>(null);
    const visibilityAction = visibility?.actionFor(item) ?? null;

    async function download() {
        setIsDownloading(true);
        try {
            const blob = await queryClient.fetchQuery(
                createDownloadGetQueryOptions({
                    userId,
                    bucketName,
                    key: item.s3_object_key,
                }),
            );

            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = item.file_name;
            anchor.rel = "noopener";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            // Revoked on a later tick so the browser can start the transfer.
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            onError(
                toErrorMessage(
                    error,
                    `Could not download "${item.file_name}".`,
                ),
            );
        } finally {
            setIsDownloading(false);
        }
    }

    return (
        <MenuTrigger>
            <span ref={wrapperRef} className="contents">
                <Button
                    aria-label={`Actions for ${item.file_name}`}
                    variant="quiet"
                    className="row-span-2 place-self-center"
                >
                    <MoreHorizontal aria-hidden className="h-5 w-5" />
                </Button>
            </span>
            <Menu>
                <MenuItem
                    {...cy("dStorage_download")}
                    id="download"
                    isDisabled={isDownloading}
                    onAction={() => void download()}
                >
                    <DownloadIcon aria-hidden className="h-4 w-4" />
                    {isDownloading ? "Downloading…" : "Download"}
                </MenuItem>
                <MenuItem id="copy" onAction={() => onCopy(item)}>
                    <CopyIcon aria-hidden className="h-4 w-4" /> Copy…
                </MenuItem>
                {visibility !== undefined && visibilityAction !== null && (
                    <MenuItem
                        // React Aria collection nodes cannot change `id`; a
                        // refetch can flip the action while the menu is open,
                        // so remount per action.
                        key={visibilityAction}
                        {...cy(
                            visibilityAction === "make-public"
                                ? "dStorage_make_public"
                                : "dStorage_make_private",
                        )}
                        id={visibilityAction}
                        isDisabled={visibility.isPending(item)}
                        onAction={() =>
                            visibility.invoke(
                                item,
                                wrapperRef.current?.querySelector("button") ??
                                    null,
                            )
                        }
                    >
                        {visibilityAction === "make-public" ? (
                            <GlobeIcon aria-hidden className="h-4 w-4" />
                        ) : (
                            <LockIcon aria-hidden className="h-4 w-4" />
                        )}
                        {visibilityMenuLabel(visibilityAction)}
                    </MenuItem>
                )}
                {canDelete && (
                    <MenuItem id="delete" onAction={() => onDelete(item)}>
                        <TrashIcon aria-hidden className="h-4 w-4" /> Delete…
                    </MenuItem>
                )}
            </Menu>
        </MenuTrigger>
    );
}
