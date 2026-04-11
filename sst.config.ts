/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "sqldev",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: { "aws-native": "1.58.0" },
    };
  },
  async run() {
    await import("./infra/realtime");
    const { frontend } = await import("./infra/web");
    if (["dev"].includes($app.stage)) {
      return;
    }
    // https://github.com/anomalyco/sst/issues/6198#issuecomment-3637447058
    new awsnative.lambda.Permission("InvokePermission", {
      action: "lambda:InvokeFunction",
      functionName: frontend.nodes.server!.name,
      principal: "*",
      invokedViaFunctionUrl: true,
    });
  },
});
