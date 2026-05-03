import React, { Suspense, lazy } from "react";

const NewTodoButton = lazy(() => import("./NewTodoButton.tsx"));
export default function LazyLoadedNewTodoButton() {
    return (
        <Suspense fallback={<p>Loading...</p>}>
            <NewTodoButton />
        </Suspense>
    );
}
