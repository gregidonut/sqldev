export const Vpc = ["dev"].includes($app.stage)
  ? null
  : new sst.aws.Vpc("sqldevSupabaseVPC", {
      az: ["ap-east-1b"],
      nat: "ec2",
      bastion: true,
    });
