import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
    CopyIcon,
    DownloadIcon,
    MoreHorizontal,
    TrashIcon,
} from "lucide-react";
import { Button } from "../Button.tsx";
import { Menu, MenuItem, MenuTrigger } from "../Menu.tsx";
import { toErrorMessage } from "./storageDisplay.tsx";
import createDownloadGetQueryOptions from "../queryOptions/createDownloadGet.ts";
import type { StorageRow } from "../queryOptions/types.ts";
import { cy } from "@/utils/cy";

interface StorageActionMenuProps {
    item: StorageRow;
    bucketName: string;
    userId: string;
    canDelete: boolean;
    onCopy: (item: StorageRow) => void;
    onDelete: (item: StorageRow) => void;
    onError: (message: string) => void;
}

export function StorageActionMenu({
    item,
    bucketName,
    userId,
    canDelete,
    onCopy,
    onDelete,
    onError,
}: StorageActionMenuProps) {
    const queryClient = useQueryClient();
    const [isDownloading, setIsDownloading] = useState(false);

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
            <Button
                aria-label={`Actions for ${item.file_name}`}
                variant="quiet"
                className="row-span-2 place-self-center"
            >
                <MoreHorizontal aria-hidden className="h-5 w-5" />
            </Button>
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
                {canDelete && (
                    <MenuItem id="delete" onAction={() => onDelete(item)}>
                        <TrashIcon aria-hidden className="h-4 w-4" /> Delete…
                    </MenuItem>
                )}
            </Menu>
        </MenuTrigger>
    );
}
