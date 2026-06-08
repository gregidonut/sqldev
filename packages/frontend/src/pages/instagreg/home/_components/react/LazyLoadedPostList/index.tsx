import React, { Suspense, lazy } from "react";
import {
    MQTTPropsStore,
    type MQTTProps,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";

const List = lazy(() => import("@/components/react/DDrvList"));

export default function LazyLoadedPostList(props: MQTTProps) {
    MQTTPropsStore.set(props);

    return (
        <Suspense fallback={<p>Loading...</p>}>
            <List view="igPosts" />
        </Suspense>
    );
}
