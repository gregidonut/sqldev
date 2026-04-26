import React, { Suspense, lazy } from "react";

import { CurrentPageContext } from "./CurrentPageContext.ts";

const NavList = lazy(() => import("./NavList"));

export default function ComponentsHeader({
    pathname,
    staticpaths,
}: {
    pathname: string;
    staticpaths: string[];
}) {
    return (
        <header className="flex-row-start">
            <nav className="flex-row-start gap-3 text-[0.7rem] ">
                <Suspense fallback={<div>Loading...</div>}>
                    <CurrentPageContext.Provider value={pathname}>
                        <NavList
                            pathname={pathname}
                            staticpaths={staticpaths}
                        />
                    </CurrentPageContext.Provider>
                </Suspense>
            </nav>
        </header>
    );
}
