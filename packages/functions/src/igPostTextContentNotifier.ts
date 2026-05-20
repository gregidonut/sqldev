import {
  IoTDataPlaneClient,
  PublishCommand,
} from "@aws-sdk/client-iot-data-plane";
import { Resource } from "sst";

const iotClient = new IoTDataPlaneClient({
  endpoint: `https://${Resource.SQLDevRealtimeSST.endpoint}`,
});

export const handler = async (event: any) => {
  const body =
    typeof event.body === "string" ? JSON.parse(event.body) : event.body;

  const topic = `${Resource.App.name}/${Resource.App.stage}/${body.view}`;

  await iotClient.send(
    new PublishCommand({
      topic,
      payload: JSON.stringify({
        message: "new_post_content",
      }),
      qos: 1,
    }),
  );

  return { statusCode: 200, body: "ok" };
};
