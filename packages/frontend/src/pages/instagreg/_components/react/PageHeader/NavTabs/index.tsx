import React from "react";
import { Tabs, TabList } from "@/components/ui/Tabs";
import { usePageHeader } from "@/pages/instagreg/_components/react/PageHeader/PageHeaderContext.ts";
import TabLink from "./TabLink.tsx";

export default function NavTabs() {
    const pathname = usePageHeader();
    return (
        <nav>
            <Tabs selectedKey={pathname}>
                <TabList aria-label="Tabs">
                    <TabLink text="home" />
                    <TabLink text="profile" />
                    <TabLink text="settings" />
                </TabList>
            </Tabs>
        </nav>
    );
}
