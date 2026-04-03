import { Tabs, TabList, Tab } from "@/components/ui/Tabs";
import { usePageHeader } from "@/pages/instagreg/_components/react/PageHeader/PageHeaderContext.ts";

export default function NavTabs() {
    const pathname = usePageHeader();
    return (
        <nav>
            <Tabs selectedKey={pathname}>
                <TabList aria-label="Tabs">
                    <Tab id="home" href="/instagreg/home">
                        Home
                    </Tab>
                    <Tab id="profile" href="/instagreg/profile">
                        Profile
                    </Tab>
                    <Tab id="settings" href="/instagreg/settings">
                        Settings
                    </Tab>
                </TabList>
            </Tabs>
        </nav>
    );
}
