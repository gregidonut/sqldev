import React from "react";
import { FileTrigger } from "react-aria-components/FileTrigger";
import { isFileDropItem } from "react-aria-components/useDrop";
import { Button } from "../Button";
import { DropZone, Text } from "../DropZone";
import { MAX_UPLOAD_FILES, type StorageUppy } from "./useStorageUppy";

export function UploadFileField({
    uppy,
    stagedCount,
    isDisabled,
    onStage,
}: {
    uppy: StorageUppy;
    stagedCount: number;
    isDisabled?: boolean;
    /**
     * Runs before the files reach Uppy. `addFiles` emits `restriction-failed`
     * for rejected files before `file-added` for accepted ones, so anything
     * resetting that error has to happen ahead of the call.
     */
    onStage: () => void;
}) {
    function stageFiles(files: File[]) {
        if (files.length === 0) {
            return;
        }

        onStage();

        // addFiles keeps the valid files when a sibling trips a restriction and
        // reports the rejected ones through `restriction-failed`, which a loop
        // over addFile would not do.
        uppy.addFiles(
            files.map((file) => ({
                name: file.name,
                type: file.type,
                data: file,
            })),
        );
    }

    return (
        <div className="flex flex-col gap-1 font-sans">
            <span className="w-fit text-sm font-medium text-drac-foreground">
                Files
            </span>
            <DropZone
                isDisabled={isDisabled}
                getDropOperation={() => "copy"}
                onDrop={async (event) => {
                    stageFiles(
                        await Promise.all(
                            event.items
                                .filter(isFileDropItem)
                                .map((item) => item.getFile()),
                        ),
                    );
                }}
                className="w-full flex-col gap-3 p-6"
            >
                {/* Names the drop zone for assistive technology. */}
                <Text slot="label" className="text-sm">
                    {stagedCount > 0
                        ? `${stagedCount} of ${MAX_UPLOAD_FILES} files staged`
                        : `Drop up to ${MAX_UPLOAD_FILES} files here to upload`}
                </Text>
                <FileTrigger
                    allowsMultiple
                    onSelect={(files) =>
                        stageFiles(files ? Array.from(files) : [])
                    }
                >
                    <Button variant="secondary" isDisabled={isDisabled}>
                        Browse…
                    </Button>
                </FileTrigger>
            </DropZone>
        </div>
    );
}
