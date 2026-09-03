import React, { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { StorageCRUDTableProps } from "./storage/StorageCRUDTable.tsx";

const StorageCRUDTable = lazy(() => import("./storage/StorageCRUDTable.tsx"));

// Module scoped so remounts of the island keep the cache and so mutation
// invalidation still reaches the list query.
const queryClient = new QueryClient();

export default function Index(props: StorageCRUDTableProps): React.ReactNode {
    return (
        <QueryClientProvider client={queryClient}>
            <Suspense
                fallback={
                    <p className="p-4 font-sans text-sm text-drac-comment">
                        Loading storage…
                    </p>
                }
            >
                <StorageCRUDTable {...props} />
            </Suspense>
        </QueryClientProvider>
    );
}
