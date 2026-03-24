export const Vpc = ["dev", "staging"].includes($app.stage)
    ? null
    : new sst.aws.Vpc("sqldevSupabaseVPC", {
        az: 1,
        nat: "ec2",
    });
