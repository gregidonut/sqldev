import React, { Suspense, lazy, useEffect } from "react";
import {
    MQTTPropsStore,
    type MQTTProps,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";

const List = lazy(() => import("@/components/react/DDrvList"));

export default function LazyLoadedPostList(props: MQTTProps) {
    MQTTPropsStore.set(props);
    useEffect(function () {
        useListStore.getState().setCurrentView("tdsTodoSpaces");
    }, []);

    return (
        <Suspense fallback={<p>Loading...</p>}>
            <List />
        </Suspense>
    );
}
