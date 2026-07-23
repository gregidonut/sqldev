import { GridList } from "@/components/ui/GridList.tsx";
import React, { type ComponentType } from "react";
import {
    itemComponents,
    viewIdKeys,
    type ViewMap,
} from "@/components/react/DDrvList/viewMap.ts";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";

export default function ListUI<K extends keyof ViewMap>({
    posts,
}: {
    posts: ViewMap[K][];
}) {
    const { currentView: view } = useListStore();
    if (!view) return null;

    const viewKey = view as K;
    const Item = itemComponents[viewKey] as ComponentType<{
        post: ViewMap[K];
        view: K;
    }>;

    const idKey = viewIdKeys[viewKey];

    return (
        <GridList
            className="w-full"
            aria-label={view}
            // selectionMode="single"
            layout="grid"
            items={posts.map(function (p) {
                return {
                    ...p,
                    id: p[idKey] as string,
                };
            })}
            disallowTypeAhead={true}
        >
            {(post) => <Item post={post} view={viewKey} />}
        </GridList>
    );
}
