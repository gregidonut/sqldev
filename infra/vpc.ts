export const NatEip = ["dev"].includes($app.stage)
  ? null
  : new aws.ec2.Eip("nat-eip", { domain: "vpc" });

export const Vpc = ["dev"].includes($app.stage)
  ? null
  : new sst.aws.Vpc("sqldevSupabaseVPC", {
      az: ["ap-east-1b"],
      bastion: true,
      nat: {
        type: "ec2",
        ip: NatEip ? [NatEip.id] : undefined, // Attach the EIP here
      },
    });
