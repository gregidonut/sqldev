import React, { Suspense, lazy } from "react";

const MovableTreeWithData = lazy(() => import("./MovableTreeWithData"));
export default function Index() {
    return (
        <Suspense fallback={<p>loading</p>}>
            <MovableTreeWithData />
        </Suspense>
    );
}
