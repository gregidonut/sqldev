import React, { createContext, useContext } from "react";
import {
    useLatestActivePreview,
    type AnimationRegistration,
} from "./useLatestActivePreview.ts";

type PreviewCoordinatorValue = {
    readonly activeInstanceKey: string | null;
    readonly onActiveChange: (instanceKey: string, active: boolean) => void;
    readonly registerAnimation: AnimationRegistration;
};

const PreviewContext = createContext<PreviewCoordinatorValue | null>(null);

export function PreviewCoordinator({
    children,
}: {
    children: React.ReactNode;
}): React.ReactNode {
    const value = useLatestActivePreview();
    return (
        <PreviewContext.Provider value={value}>
            {children}
        </PreviewContext.Provider>
    );
}

export function useOptionalPreviewCoordinator(): PreviewCoordinatorValue | null {
    return useContext(PreviewContext);
}
