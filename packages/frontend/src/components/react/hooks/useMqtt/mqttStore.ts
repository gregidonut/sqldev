import { atom } from "nanostores";

export interface MQTTProps {
    realtimeEndpoint: string;
    realtimeAuthorizer: string;
    appName: string;
    appStage: string;
}

export const MQTTPropsStore = atom<MQTTProps>({
    realtimeEndpoint: "",
    realtimeAuthorizer: "",
    appName: "",
    appStage: "",
});
