import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Image } from "@pulumi/docker-build";
import { all, interpolate, jsonStringify } from "@pulumi/pulumi";
import { bucket } from "./storage";
import { Vpc as SupabaseVPC } from "./vpc";
import {
  jobDeadLetter,
  jobQueue,
  jobTable,
  resultBucket,
} from "./jobs";

const instanceType = process.env.HOST_INSTANCE_TYPE ?? "t3.medium";
const volumeGb = Number(process.env.HOST_VOLUME_GB ?? "30");
// The standard AL2023 snapshot is 8 GB, and AWS rejects a smaller root volume.
const rootVolumeGb = 8;

if (!Number.isInteger(volumeGb) || volumeGb < 30) {
  throw new Error("HOST_VOLUME_GB must be an integer of at least 30");
}

const selfhost = join(process.cwd(), "packages/backend/selfhost");
const bootstrap = readFileSync(join(selfhost, "bootstrap.sh"), "utf8");
// Included in user data so a bootstrap change replaces the instance.
const bootstrapSHA = createHash("sha256").update(bootstrap).digest("hex");

export const host =
  ["dev"].includes($app.stage) || !SupabaseVPC
    ? undefined
    : createHost(SupabaseVPC);

function createHost(vpc: NonNullable<typeof SupabaseVPC>) {
  const dbPassword = new random.RandomPassword("HostDbPassword", {
    length: 32,
    special: false,
  });
  const jwtSecret = new random.RandomPassword("HostJwtSecret", {
    length: 48,
    special: false,
  });
  const workerPassword = new random.RandomPassword("HostWorkerPassword", {
    length: 32,
    special: false,
  });
  const imagorSecret = new random.RandomPassword("HostImagorSecret", {
    length: 48,
    special: false,
  });

  const secret = new aws.secretsmanager.Secret("HostSecret", {
    description: "Credentials for the private Supabase and DBOS host",
  });
  new aws.secretsmanager.SecretVersion("HostSecretVersion", {
    secretId: secret.id,
    secretString: jsonStringify({
      postgresPassword: dbPassword.result,
      jwtSecret: jwtSecret.result,
      workerPassword: workerPassword.result,
      imagorSecret: imagorSecret.result,
    }),
  });

  const repositoryName = `${$app.name}-${$app.stage}-worker`;
  const repository = new aws.ecr.Repository("WorkerRepository", {
    name: repositoryName,
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    encryptionConfigurations: [{ encryptionType: "AES256" }],
  });
  const registry = repository.repositoryUrl.apply((url) => url.split("/")[0]);
  const auth = aws.ecr.getAuthorizationTokenOutput({
    registryId: repository.registryId,
  });
  const dockerfile = join(
    process.cwd(),
    "packages/functions/cmd/supabaseworker/Dockerfile",
  );
  const image = new Image("WorkerImage", {
    tags: [interpolate`${repository.repositoryUrl}:latest`],
    context: { location: process.cwd() },
    dockerfile: {
      location: dockerfile,
    },
    platforms: ["linux/amd64"],
    push: true,
    buildOnPreview: false,
    registries: [
      {
        address: registry,
        username: auth.userName,
        password: auth.password,
      },
    ],
  });
  const imagorRepositoryName = `${$app.name}-${$app.stage}-imagor`;
  const imagorRepository = new aws.ecr.Repository("ImagorRepository", {
    name: imagorRepositoryName,
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    encryptionConfigurations: [{ encryptionType: "AES256" }],
  });
  const imagorImage = new Image("ImagorImage", {
    tags: [interpolate`${imagorRepository.repositoryUrl}:latest`],
    context: {
      location: join(selfhost, "imagor"),
    },
    dockerfile: {
      location: join(selfhost, "imagor/Dockerfile"),
    },
    platforms: ["linux/amd64"],
    push: true,
    buildOnPreview: false,
    registries: [
      {
        address: registry,
        username: auth.userName,
        password: auth.password,
      },
    ],
  });
  const imagorRef = interpolate`${imagorRepository.repositoryUrl}@${imagorImage.digest}`;

  const configBucket = new sst.aws.Bucket("HostConfigBucket");
  new aws.s3.BucketObject("HostBootstrap", {
    bucket: configBucket.name,
    key: "bootstrap.sh",
    content: bootstrap,
    contentType: "text/x-shellscript",
  });

  const role = new aws.iam.Role("HostRole", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ec2.amazonaws.com",
    }),
  });
  new aws.iam.RolePolicyAttachment("HostSessionManager", {
    role: role.name,
    policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  });
  new aws.iam.RolePolicy("HostPolicy", {
    role: role.id,
    policy: all([
      jobQueue.arn,
      jobDeadLetter.arn,
      jobTable.arn,
      resultBucket.arn,
      bucket.arn,
      repository.arn,
      imagorRepository.arn,
      secret.arn,
      configBucket.arn,
    ]).apply(
      ([
        queueArn,
        deadLetterArn,
        tableArn,
        resultArn,
        appBucketArn,
        repositoryArn,
        imagorRepositoryArn,
        secretArn,
        configArn,
      ]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: [
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:ChangeMessageVisibility",
                "sqs:GetQueueAttributes",
              ],
              Resource: [queueArn, deadLetterArn],
            },
            {
              Effect: "Allow",
              Action: [
                "dynamodb:GetItem",
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
              ],
              Resource: [tableArn],
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject", "s3:PutObject"],
              Resource: [`${resultArn}/*`],
            },
            {
              Effect: "Allow",
              Action: [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket",
              ],
              Resource: [appBucketArn, `${appBucketArn}/*`],
            },
            {
              Effect: "Allow",
              Action: ["s3:GetObject"],
              Resource: [`${configArn}/*`],
            },
            {
              Effect: "Allow",
              Action: ["secretsmanager:GetSecretValue"],
              Resource: [secretArn],
            },
            {
              Effect: "Allow",
              Action: ["ecr:GetAuthorizationToken"],
              Resource: "*",
            },
            {
              Effect: "Allow",
              Action: [
                "ecr:BatchCheckLayerAvailability",
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
              ],
              Resource: [repositoryArn, imagorRepositoryArn],
            },
            {
              Effect: "Allow",
              Action: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              Resource: `arn:aws:logs:ap-east-1:*:log-group:/sqldev/${$app.stage}/host*`,
            },
          ],
        }),
    ),
  });

  const profile = new aws.iam.InstanceProfile("HostProfile", {
    role: role.name,
  });
  const securityGroup = new aws.ec2.SecurityGroup("HostSecurityGroup", {
    vpcId: vpc.id,
    description: "Private Supabase host with no inbound access",
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  });
  const ami = aws.ec2.getAmiOutput({
    mostRecent: true,
    owners: ["amazon"],
    filters: [
      { name: "name", values: ["al2023-ami-2023.*-x86_64"] },
      { name: "architecture", values: ["x86_64"] },
      { name: "virtualization-type", values: ["hvm"] },
    ],
  });
  const subnetId = vpc.privateSubnets.apply((ids) => ids[0]);
  const dataVolume = new aws.ebs.Volume("HostDataVolume", {
    availabilityZone: aws.ec2.getSubnetOutput({ id: subnetId }).availabilityZone,
    size: volumeGb,
    type: "gp3",
    encrypted: true,
  });
  const userData = all([
    configBucket.name,
    secret.arn,
    jobQueue.url,
    jobTable.name,
    resultBucket.name,
    bucket.name,
    registry,
    image.ref,
    imagorRef,
    dataVolume.id,
  ]).apply(
    ([
      configName,
      secretArn,
      queueUrl,
      tableName,
      resultName,
      appBucket,
      registryAddress,
      imageRef,
      imagorImageRef,
      dataVolumeId,
    ]) => `#!/bin/bash
set -euo pipefail
export CONFIG_BUCKET='${configName}'
export SECRET_ARN='${secretArn}'
export AWS_REGION='ap-east-1'
export APP_NAME='${$app.name}'
export APP_STAGE='${$app.stage}'
export JOB_QUEUE_URL='${queueUrl}'
export JOB_TABLE_NAME='${tableName}'
export JOB_RESULT_BUCKET='${resultName}'
export APP_BUCKET='${appBucket}'
export REGISTRY='${registryAddress}'
export IMAGE='${imageRef}'
export IMAGOR_IMAGE='${imagorImageRef}'
export BOOTSTRAP_SHA='${bootstrapSHA}'
export DATA_VOLUME_ID='${dataVolumeId}'
install -d -m 0700 /opt/sqldev
aws s3 cp "s3://\${CONFIG_BUCKET}/bootstrap.sh" /opt/sqldev/bootstrap.sh
bash /opt/sqldev/bootstrap.sh
`,
  );

  const instance = new aws.ec2.Instance("SupabaseHost", {
    ami: ami.id,
    instanceType,
    subnetId,
    vpcSecurityGroupIds: [securityGroup.id],
    iamInstanceProfile: profile.name,
    associatePublicIpAddress: false,
    userData,
    userDataReplaceOnChange: true,
    metadataOptions: {
      httpEndpoint: "enabled",
      httpTokens: "required",
      httpPutResponseHopLimit: 2,
    },
    rootBlockDevice: {
      volumeType: "gp3",
      volumeSize: rootVolumeGb,
      encrypted: true,
      deleteOnTermination: true,
    },
    tags: {
      Name: `${$app.name}-${$app.stage}-supabase`,
    },
  });
  // Detach the data disk before attaching it to a replacement instance.
  new aws.ec2.VolumeAttachment(
    "HostDataAttachment",
    {
      deviceName: "/dev/sdf",
      volumeId: dataVolume.id,
      instanceId: instance.id,
      forceDetach: true,
    },
    { deleteBeforeReplace: true },
  );

  return { role, instance };
}
