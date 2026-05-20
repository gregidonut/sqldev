import { clerkJWKSPublicKey } from "./secrets";

const apEast1 = new aws.Provider("ApEast1Provider", {
  region: "ap-east-1",
});

export const realtime = new sst.aws.Realtime(
  "SQLDevRealtimeSST",
  {
    authorizer: {
      handler: "packages/functions/src/realtimeAuthorizer.handler",
      link: [clerkJWKSPublicKey],
    },
  },
  { provider: apEast1 },
);
