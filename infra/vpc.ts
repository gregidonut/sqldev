export const Vpc = ["dev"].includes($app.stage)
  ? null
  : new sst.aws.Vpc("sqldevSupabaseVPC", {
      az: 1,
      nat: "ec2",
    });
