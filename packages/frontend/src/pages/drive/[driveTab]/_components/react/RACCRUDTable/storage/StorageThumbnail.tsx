import React from "react";
import { StorageMediaPreview } from "@/components/react/StorageTile/StorageMediaPreview.tsx";
import type { AnimationRegistration } from "@/components/react/StorageTile/useLatestActivePreview.ts";

interface StorageThumbnailProps {
    fileName: string;
    sourceKey: string;
    userId: string;
    isActive?: boolean;
    onActiveChange?: (instanceKey: string, active: boolean) => void;
    registerAnimation?: AnimationRegistration;
}

// Drive adapter. The card around this preview still owns selection, visibility,
// timestamps, and actions. The media surface is shared with rendered posts.
export function StorageThumbnail({
    fileName,
    sourceKey,
    userId,
    isActive,
    onActiveChange,
    registerAnimation,
}: StorageThumbnailProps): React.ReactNode {
    return (
        <StorageMediaPreview
            fileName={fileName}
            instanceKey={sourceKey}
            userId={userId}
            resource={{ kind: "source", sourceKey }}
            isActive={isActive}
            onActiveChange={onActiveChange}
            registerAnimation={registerAnimation}
        />
    );
}
