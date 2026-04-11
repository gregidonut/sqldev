import React from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useStore } from "@nanostores/react";
import { $authStore } from "@clerk/astro/client";

export default function UserBadge({
    clerk_user_id,
}: {
    clerk_user_id: string;
}) {
    const { userId } = useStore($authStore);
    const {
        data: user,
        isLoading,
        error,
    } = useQuery({
        queryKey: [
            "get",
            "igPosts",
            {
                userId,
            },
            { user: clerk_user_id },
        ],
        queryFn: async () => {
            const response = await axios.get(`/api/users/get/${clerk_user_id}`);
            return response.data;
        },
        enabled: !!clerk_user_id,
        staleTime: 1000 * 60 * 10, // 10 minutes cache
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 animate-pulse">
                <div className="w-6 h-6 rounded-full bg-drac-comment" />
                <div className="h-4 w-20 bg-drac-comment rounded" />
            </div>
        );
    }

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
            <span className="text-sm font-semibold text-drac-pink italic">
                @{user.username}
            </span>
        </div>
    );
}
