import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import { cy } from "@/utils/cy";
import { StorageMediaPreview } from "./StorageMediaPreview.tsx";
import { storageReferenceQueryOptions } from "./storageReference.ts";

const UNAVAILABLE = "Attachment unavailable";

export function StorageReferenceTile({
    storageObjectId,
    label,
    instanceKey,
}: {
    storageObjectId: string;
    label: string;
    instanceKey: string;
}): React.ReactNode {
    const { userId } = useStore($authStore);
    const reference = useQuery(
        storageReferenceQueryOptions(userId ?? "", storageObjectId),
    );

    if (reference.isPending) {
        return (
            <p {...cy("storage_reference_loading")} className="text-drac-comment">
                Loading attachment
            </p>
        );
    }
    if (reference.isError || reference.data?.kind !== "ready") {
        return (
            <p {...cy("storage_reference_unavailable")}>{UNAVAILABLE}</p>
        );
    }

    const caption = label.trim() === "" ? reference.data.fileName : label;
    return (
        <div
            {...cy("storage_reference_tile")}
            className="not-prose my-3 w-full max-w-sm"
        >
            <StorageMediaPreview
                fileName={reference.data.fileName}
                instanceKey={instanceKey}
                userId={userId ?? ""}
                resource={{
                    kind: "object",
                    storageObjectId,
                    revisionId: reference.data.revisionId,
                }}
            />
            <p className="mt-1 truncate text-sm text-drac-foreground">
                {caption}
            </p>
        </div>
    );
}
