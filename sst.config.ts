/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "sqldev",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: { region: "ap-east-1" },
        "aws-native": "1.58.0",
      },
    };
  },
  async run() {
    await import("./infra/realtime");
    await import("./infra/api");
    await import("./infra/web");
    if (["dev"].includes($app.stage)) {
      return;
    }
  },
});
