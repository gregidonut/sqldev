import React from "react";
import { XIcon } from "lucide-react";
import { ProgressBar } from "react-aria-components/ProgressBar";
import { Button } from "../Button";
import { UploadFileNameField } from "./UploadFileNameField";
import type { StorageUppy, StorageUppyFile } from "./useStorageUppy";

export function UploadFileRow({
    uppy,
    file,
    index,
    isUploading,
}: {
    uppy: StorageUppy;
    file: StorageUppyFile;
    index: number;
    isUploading: boolean;
}) {
    const percentage = Math.round(file.progress.percentage ?? 0);

    return (
        <li className="flex flex-col gap-2 rounded-lg border border-drac-selection bg-drac-background p-3">
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <UploadFileNameField
                        index={index}
                        aria-label={`Destination name for ${file.name}`}
                        isDisabled={isUploading}
                    />
                </div>
                <Button
                    variant="quiet"
                    aria-label={`Remove ${file.name}`}
                    isDisabled={isUploading}
                    onPress={() => uppy.removeFile(file.id)}
                >
                    <XIcon aria-hidden className="h-4 w-4" />
                </Button>
            </div>

            {file.progress.uploadStarted !== null && (
                <ProgressBar
                    value={percentage}
                    aria-label={`Upload progress for ${file.name}`}
                    className="flex items-center gap-2"
                >
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-drac-selection forced-colors:bg-[Canvas] forced-colors:outline forced-colors:outline-1 forced-colors:outline-[ButtonBorder]">
                        <div
                            className="h-full rounded-full bg-drac-green transition-[width] forced-colors:bg-[Highlight]"
                            style={{ width: `${percentage}%` }}
                        />
                    </div>
                    <span className="font-sans text-xs tabular-nums text-drac-comment">
                        {percentage}%
                    </span>
                </ProgressBar>
            )}

            {file.error && (
                <span
                    role="alert"
                    className="font-sans text-xs text-drac-red forced-colors:text-[Mark]"
                >
                    {file.error}
                </span>
            )}
        </li>
    );
}
