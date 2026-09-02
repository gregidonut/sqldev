import React from "react";
import { Tabs, TabList } from "@/components/ui/Tabs";
import { OBJECTS_TABS } from "@/utils/storage/objectsTab";
import { usePageNav } from "@/pages/drive/_components/react/PageNav/PageNavContext.ts";
import ViewTabLink from "./ViewTabLink.tsx";

export default function ViewTabs() {
    const tab = usePageNav();
    return (
        <Tabs orientation="vertical" selectedKey={tab}>
            <TabList aria-label="drive views">
                {OBJECTS_TABS.map((objectsTab) => (
                    <ViewTabLink key={objectsTab} tab={objectsTab} />
                ))}
            </TabList>
        </Tabs>
    );
}
