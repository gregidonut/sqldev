import { astroAppDomain } from "./secrets";

// Local `sst dev` and Cypress serve the app from Astro's dev server.
const localOrigins = $app.stage === "dev" ? ["http://localhost:4321"] : [];

export const bucket = new sst.aws.Bucket("SQLDevBucket", {
  cors: {
    allowOrigins: [astroAppDomain.value, ...localOrigins],
    allowMethods: ["GET", "PUT", "HEAD"],
    allowHeaders: ["*"],
    maxAge: "1 hour",
  },
});
