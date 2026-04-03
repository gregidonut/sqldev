import React, { Suspense, lazy } from "react";
import { PageHeaderContext } from "./PageHeaderContext";

const NavTabs = lazy(() => import("./NavTabs"));

export default function Header({ pathname }: { pathname: string }) {
    return (
        <header className="border-b-4 border-b-drac-comment w-full">
            <Suspense fallback={<div>Loading...</div>}>
                <PageHeaderContext.Provider value={pathname}>
                    <NavTabs />
                </PageHeaderContext.Provider>
            </Suspense>
        </header>
    );
}
