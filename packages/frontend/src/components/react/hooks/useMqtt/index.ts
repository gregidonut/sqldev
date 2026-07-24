import { useEffect } from "react";
import type { MqttClient } from "mqtt";
import mqtt from "mqtt";
import { $authStore } from "@clerk/astro/client";
import { useStore } from "@nanostores/react";
import type { QueryObserverResult } from "@tanstack/react-query";
import { MQTTPropsStore } from "@/components/react/hooks/useMqtt/mqttStore.ts";

type AuthStore = ReturnType<typeof useStore<typeof $authStore>>;
type SessionType = AuthStore["session"];

interface UseMqttProps {
    session: SessionType;
    refetch: () => Promise<QueryObserverResult>;
    topic: string;
    messagesToListenTo: string[];
}

export default function index({
    session,
    refetch,
    topic,
    messagesToListenTo,
}: UseMqttProps) {
    const {
        realtimeEndpoint,
        realtimeAuthorizer,
        appName,
        appStage,
        clerkUserId,
    } = useStore(MQTTPropsStore);

    useEffect(() => {
        if (!session || !clerkUserId) return;

        let mqttClient: MqttClient | null = null;
        let isConnecting = false;
        let isDisposed = false;
        let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

        async function initMqtt() {
            // Guard against multiple concurrent connection attempts
            if (isConnecting || isDisposed) return;
            isConnecting = true;

            try {
                if (mqttClient) {
                    mqttClient.end();
                    mqttClient = null;
                }

                const token = await session?.getToken();
                if (!token || isDisposed) return;

                const client = createConnection(
                    realtimeEndpoint,
                    realtimeAuthorizer,
                    token,
                );
                mqttClient = client;

                const scheduleReconnect = () => {
                    if (isDisposed || reconnectTimeout) return;
                    reconnectTimeout = setTimeout(() => {
                        reconnectTimeout = null;
                        initMqtt();
                    }, 1000);
                };

                client.on("connect", () => {
                    if (isDisposed) {
                        client.end(true);
                        return;
                    }
                    const userTopic = `${appName}/${appStage}/user/${clerkUserId}/${topic}`;
                    const publicTopic = `${appName}/${appStage}/public/${topic}`;
                    client.subscribe([userTopic, publicTopic]);
                });

                client.on("message", (_topic, message) => {
                    if (isDisposed) return;
                    const m = (
                        JSON.parse(message.toString()) as { message: string }
                    ).message;
                    if (messagesToListenTo.includes(m)) refetch();
                });

                client.on("error", (err) => {
                    if (isDisposed) return;
                    console.error("MQTT error:", err);
                    client.end(true);
                    if (mqttClient === client) mqttClient = null;
                    scheduleReconnect();
                });

                client.on("close", () => {
                    if (isDisposed) return;
                    if (mqttClient === client) mqttClient = null;
                    scheduleReconnect();
                });

                client.connect();
            } catch (err) {
                console.error("Failed to initialize MQTT:", err);
            } finally {
                isConnecting = false;
            }
        }

        initMqtt();

        return () => {
            isDisposed = true;
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
            }
            if (mqttClient) {
                mqttClient.end(true);
            }
        };
    }, [
        session,
        clerkUserId,
        realtimeEndpoint,
        realtimeAuthorizer,
        appName,
        appStage,
        refetch,
        topic,
        messagesToListenTo,
    ]);
}

function createConnection(endpoint: string, authorizer: string, token: string) {
    return mqtt.connect(
        `wss://${endpoint}/mqtt?x-amz-customauthorizer-name=${authorizer}`,
        {
            protocolVersion: 5,
            manualConnect: true,
            username: "", // Must be empty for the authorizer
            password: token, // Passed as the token to the authorizer
            clientId: `client_${window.crypto.randomUUID()}`,
            reconnectPeriod: 0, // Disable internal reconnection, we handle it manually to refresh the token
            connectTimeout: 5000,
        },
    );
}
