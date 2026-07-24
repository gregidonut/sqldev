import React, { Suspense, lazy } from "react";

const NewTodoButton = lazy(() => import("./NewTodoButton.tsx"));
export default function LazyLoadedNewTodoButton({
    tdsTodoSpaceId,
}: {
    tdsTodoSpaceId: string;
}) {
    return (
        <Suspense fallback={<p>Loading...</p>}>
            <NewTodoButton tdsTodoSpaceId={tdsTodoSpaceId} />
        </Suspense>
    );
}
