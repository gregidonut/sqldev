import { MenuTrigger, Menu, MenuItem } from "@/components/ui/Menu.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { MoreHorizontal } from "lucide-react";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import { viewStores } from "@/components/react/DDrvList/store/viewStore.ts";
import type { ViewMap } from "@/components/react/DDrvList/viewMap.ts";

export default function MenuButton<K extends keyof ViewMap>({
    postOwnerId,
    postId,
    view,
}: {
    postOwnerId: string;
    postId: string;
    view: K;
}) {
    const usePostsViewStore = viewStores[view];
    const { setIsEditing, setPostId } = usePostsViewStore();

    const { userId } = useStore($authStore);
    if (userId !== postOwnerId) return null;

    return (
        <MenuTrigger>
            <Button aria-label="Actions" variant="secondary">
                <MoreHorizontal className="w-5 h-5" />
            </Button>
            <Menu>
                <MenuItem onAction={() => alert("open")}>Open</MenuItem>
                <MenuItem
                    onAction={() => {
                        setIsEditing(true);
                        setPostId(postId);
                    }}
                >
                    Edit..
                </MenuItem>
                <MenuItem onAction={() => alert("delete")}>Delete…</MenuItem>
            </Menu>
        </MenuTrigger>
    );
}
