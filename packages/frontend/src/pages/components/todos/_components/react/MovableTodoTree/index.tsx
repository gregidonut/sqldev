import React, { Suspense, lazy } from "react";
import {
    type MQTTProps,
    MQTTPropsStore,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";

const MovableTreeWithData = lazy(() => import("./MovableTreeWithData"));
export default function MovableTodoTree(props: MQTTProps) {
    MQTTPropsStore.set(props);

    return (
        <Suspense fallback={<p>loading</p>}>
            <MovableTreeWithData />
        </Suspense>
    );
}
