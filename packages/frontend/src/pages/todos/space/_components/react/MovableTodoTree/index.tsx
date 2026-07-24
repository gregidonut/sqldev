import React, { Suspense, lazy } from "react";
import {
    type MQTTProps,
    MQTTPropsStore,
} from "@/components/react/hooks/useMqtt/mqttStore.ts";

interface MovableTodoTreeProps {
    MQTTProps: MQTTProps;
    tdsTodoSpaceId: string;
}

const MovableTreeWithData = lazy(() => import("./MovableTreeWithData"));

export default function MovableTodoTree({
    MQTTProps,
    tdsTodoSpaceId,
}: MovableTodoTreeProps) {
    MQTTPropsStore.set(MQTTProps);

    return (
        <Suspense fallback={<p>loading</p>}>
            <MovableTreeWithData tdsTodoSpaceId={tdsTodoSpaceId} />
        </Suspense>
    );
}
