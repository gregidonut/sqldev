import { realtime } from "./realtime";
import { notifySecret } from "./secrets";

export const igPostTextContentNotifier = new sst.aws.Function(
  "IgPostTextContentNotifier",
  {
    handler: "packages/functions/src/igPostTextContentNotifier.handler",
    url: true,
    link: [realtime],
  },
);

export const igPostViewNotifier = new sst.aws.Function("igPostViewNotifier", {
  handler: "packages/functions/cmd/igPostViewNotifier/main.go",
  url: true,
  runtime: "go",
  link: [realtime, notifySecret],
  environment: {
    APP_NAME: $app.name,
    APP_STAGE: $app.stage,
  },
});
