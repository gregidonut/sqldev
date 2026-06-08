import { GridList } from "@/components/ui/GridList.tsx";
import React from "react";
import {
    itemComponents,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";

export default function ListUI<K extends keyof ViewMap>({
    posts,
    view,
}: {
    posts: ViewMap[K][];
    view: K;
}) {
    const Item = itemComponents[view] as React.ComponentType<{
        post: ViewMap[K];
        view: K;
    }>;

    return (
        <GridList
            className="w-full"
            aria-label={view}
            // selectionMode="single"
            layout="grid"
            items={posts.map(function (p) {
                return {
                    ...p,
                    id: p.post_id!,
                };
            })}
            disallowTypeAhead={true}
        >
            {(post) => <Item post={post} view={view} />}
        </GridList>
    );
}
