import { realtime } from "./realtime";
import { notifySecret } from "./secrets";
import { Vpc as SupabaseVPC } from "./vpc";

export const igPostsViewNotifier = new sst.aws.Function("IgPostsViewNotifier", {
  handler: "packages/functions/cmd/igPostsViewNotifier/main.go",
  url: true,
  runtime: "go",
  link: [realtime, notifySecret],
  environment: {
    APP_NAME: $app.name,
    APP_STAGE: $app.stage,
  },
  vpc: ["dev"].includes($app.stage) ? undefined : SupabaseVPC,
});
