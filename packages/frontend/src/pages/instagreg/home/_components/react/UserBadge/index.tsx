import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";
import createIgPostsUsersGetQueryOptions from "@/pages/instagreg/home/_components/react/queryOptions/createIgPostsUsersGet.ts";

export default function UserBadge({
    clerk_user_id,
}: {
    clerk_user_id: string;
}) {
    const { userId } = useStore($authStore);
    const { data: user, error } = useSuspenseQuery(
        createIgPostsUsersGetQueryOptions(userId ?? "", clerk_user_id),
    );

    if (error || !user) {
        return (
            <span className="text-sm font-semibold text-drac-pink italic">
                @{clerk_user_id}
            </span>
        );
    }

    return (
        <div className="flex items-center gap-2">
            {user.imageUrl && (
                <img
                    src={user.imageUrl}
                    alt={user.username}
                    className="w-6 h-6 rounded-full border border-drac-purple"
                />
            )}
            <span className="text-xs font-semibold text-drac-pink italic">
                @{user.username}
            </span>
        </div>
    );
}
