import React from "react";
import { Tab } from "@/components/ui/Tabs.tsx";
import type { ObjectsTab } from "@/utils/storage/objectsTab";
import { usePageNav } from "@/pages/drive/_components/react/PageNav/PageNavContext.ts";

function toLabel(tab: ObjectsTab): string {
    const words = tab.replaceAll("_", " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function ViewTabLink({ tab }: { tab: ObjectsTab }) {
    const current = usePageNav();
    return (
        <Tab id={tab} href={`/drive/${tab}`} isDisabled={current === tab}>
            {toLabel(tab)}
        </Tab>
    );
}
