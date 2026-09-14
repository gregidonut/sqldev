import React from "react";
import List from "@/components/react/DDrvList";
import {
    MQTTPropsStore,
    type MQTTProps,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";
import { useListStore } from "@/components/react/DDrvList/store/store.ts";

export default function LazyLoadedPostList(props: MQTTProps) {
    MQTTPropsStore.set(props);
    if (useListStore.getState().currentView !== "igPosts") {
        useListStore.getState().setCurrentView("igPosts");
    }

    return <List />;
}
