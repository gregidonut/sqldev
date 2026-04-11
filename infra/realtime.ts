import { clerkJWKSPublicKey } from "./secrets";

export const realtime = new sst.aws.Realtime("SQLDevRealtimeSST", {
  authorizer: {
    handler: "packages/functions/src/realtimeAuthorizer.handler",
    link: [clerkJWKSPublicKey],
  },
});
