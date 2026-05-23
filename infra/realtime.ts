import { clerkJWKSPublicKey } from "./secrets";

const apEast1 = new aws.Provider("ApEast1Provider", {
  region: "ap-east-1",
});

export const realtime = new sst.aws.Realtime(
  "SQLDevRealtimeSST",
  {
    authorizer: {
      handler: "packages/functions/cmd/realtimeAuthorizer/main.go",
      link: [clerkJWKSPublicKey],
      runtime: "go",
      environment: {
        APP_NAME: $app.name,
        APP_STAGE: $app.stage,
      },
    },
  },
  { provider: apEast1 },
);
