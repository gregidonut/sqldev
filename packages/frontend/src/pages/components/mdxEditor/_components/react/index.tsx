import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MdxEditorDemo } from "./MdxEditorDemo.tsx";
import "@/components/react/MdxEditor/mdxEditor.css";
import "./mdxEditorDemo.css";

// Module-scoped client for this island. No devtools in the demo bundle.
const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
});

export default function MdxEditorDemoIsland(): React.JSX.Element {
    return (
        <QueryClientProvider client={queryClient}>
            <MdxEditorDemo />
        </QueryClientProvider>
    );
}
