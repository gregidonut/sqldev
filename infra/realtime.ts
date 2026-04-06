export const realtime = new sst.aws.Realtime("SQLDevRealtimeSST", {
  authorizer: "packages/functions/src/realtimeAuthorizer.handler",
});
