import React, { Suspense, lazy } from "react";
import {
    MQTTPropsStore,
    type MQTTProps,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";

const PostList = lazy(() => import("./PostList"));

export default function LazyLoadedPostList(props: MQTTProps) {
    MQTTPropsStore.set(props);

    return (
        <Suspense fallback={<p>Loading...</p>}>
            <PostList />
        </Suspense>
    );
}
