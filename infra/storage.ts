import { astroAppDomain } from "./secrets";

// Local `sst dev` and Cypress serve the app from Astro's dev server.
const localOrigins = $app.stage === "dev" ? ["http://localhost:4321"] : [];
// AstroAppDomain is the site hostname. S3 matches the browser Origin exactly,
// including the https scheme.
const appOrigin = astroAppDomain.value.apply((domain) => {
  const origin =
    domain.startsWith("http://") || domain.startsWith("https://")
      ? domain
      : `https://${domain}`;
  return origin;
});

export const bucket = new sst.aws.Bucket("SQLDevBucket", {
  cors: {
    allowOrigins: [appOrigin, ...localOrigins],
    allowMethods: ["GET", "PUT", "HEAD"],
    allowHeaders: ["*"],
    maxAge: "1 hour",
  },
});
