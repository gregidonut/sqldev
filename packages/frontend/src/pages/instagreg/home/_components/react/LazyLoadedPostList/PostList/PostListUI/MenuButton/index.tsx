import { MenuTrigger, Menu, MenuItem } from "@/components/ui/Menu";
import { Button } from "@/components/ui/Button";
import { MoreHorizontal } from "lucide-react";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";

export default function MenuButton({
    postOwnerId,
    onEdit,
}: {
    postOwnerId: string;
    onEdit: () => void;
}) {
    const { userId } = useStore($authStore);
    if (userId !== postOwnerId) return null;
    return (
        <MenuTrigger>
            <Button aria-label="Actions" variant="secondary">
                <MoreHorizontal className="w-5 h-5" />
            </Button>
            <Menu>
                <MenuItem onAction={() => alert("open")}>Open</MenuItem>
                <MenuItem onAction={onEdit}>Edit..</MenuItem>
                <MenuItem onAction={() => alert("delete")}>Delete…</MenuItem>
            </Menu>
        </MenuTrigger>
    );
}
