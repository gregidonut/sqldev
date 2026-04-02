import React, {useState, useEffect, Suspense, lazy} from "react";

// import {CurrentPageContext} from "./CurrentPageContext.tsx";

const NavList = lazy(() => import("./NavList"));

export default function ComponentsHeader() {
    const [pathname, setPathname] = useState<string>("components");
    useEffect(() => {
        setPathname(window.location.pathname.split("/").filter(Boolean).at(-1) ?? "components");
    }, []);
    return (
        <header className="flex-row-start">
            <nav className="flex-row-start gap-3 text-[0.7rem] ">
                <Suspense fallback={<div>Loading...</div>}>
                    {/*<CurrentPageContext.Provider value={pathname}>*/}
                        <NavList pathname={pathname}/>
                    {/*</CurrentPageContext.Provider>*/}
                </Suspense>
            </nav>
        </header>
    )
}
