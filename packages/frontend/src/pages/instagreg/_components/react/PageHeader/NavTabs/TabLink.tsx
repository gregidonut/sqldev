import React from "react";
import { Tab } from "@/components/ui/Tabs.tsx";
import { usePageHeader } from "@/pages/instagreg/_components/react/PageHeader/PageHeaderContext.ts";

export default function TabLink({ text }: { text: string }) {
    const pathname = usePageHeader();
    return (
        <Tab
            id={text}
            href={`/instagreg/${text}`}
            isDisabled={pathname === text}
        >
            {text.charAt(0).toUpperCase() + text.slice(1)}
        </Tab>
    );
}
