import React, { Suspense, lazy } from "react";
import type { ObjectsTab } from "@/utils/storage/objectsTab";
import { PageNavContext } from "./PageNavContext";

const ViewTabs = lazy(() => import("./ViewTabs"));

export default function PageNav({ tab }: { tab: ObjectsTab }) {
    return (
        <nav
            aria-label="drive views"
            className="self-stretch border-r-4 border-r-drac-comment"
        >
            <Suspense fallback={<div>Loading...</div>}>
                <PageNavContext.Provider value={tab}>
                    <ViewTabs />
                </PageNavContext.Provider>
            </Suspense>
        </nav>
    );
}
