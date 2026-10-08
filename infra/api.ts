import { all } from "@pulumi/pulumi";
import { NatEip, Vpc as SupabaseVPC } from "./vpc";
import { realtime } from "./realtime";
import { bucket } from "./storage";
import {
  clerkJWKSPublicKey,
  clerkSecret,
  notifySecret,
} from "./secrets";
import {
  jobDeadLetter,
  jobQueue,
  jobQueueLink,
  jobTable,
  jobTableLink,
  resultBucket,
  resultBucketLink,
} from "./jobs";
import { host } from "./host";

const dev = ["dev"].includes($app.stage);
const identity = aws.getCallerIdentityOutput();

export const apiRole = new aws.iam.Role("GoApiRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

const logArn = interpolateLogArn();
new aws.iam.RolePolicy("GoApiPolicy", {
  role: apiRole.id,
  policy: all([
    jobQueue.arn,
    jobTable.arn,
    resultBucket.arn,
    logArn,
    identity.accountId,
  ]).apply(([queueArn, tableArn, resultArn, logsArn, accountId]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["sqs:SendMessage", "sqs:GetQueueUrl"],
          Resource: queueArn,
        },
        {
          Effect: "Allow",
          Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
          Resource: [tableArn],
        },
        {
          Effect: "Allow",
          Action: ["s3:GetObject"],
          Resource: `${resultArn}/*`,
        },
        {
          Effect: "Allow",
          Action: ["iot:Publish"],
          Resource: `arn:aws:iot:ap-east-1:${accountId}:topic/${$app.name}/${$app.stage}/*`,
        },
        {
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: logsArn,
        },
        // A custom role replaces SST's default function role. In dev that role
        // is what lets the live Lambda bridge call AppSync.
        ...(dev
          ? [
              {
                Effect: "Allow",
                Action: ["appsync:*"],
                Resource: "*",
              },
            ]
          : []),
        ...(dev
          ? []
          : [
              {
                Effect: "Allow",
                Action: [
                  "ec2:CreateNetworkInterface",
                  "ec2:DescribeNetworkInterfaces",
                  "ec2:DeleteNetworkInterface",
                  "ec2:AssignPrivateIpAddresses",
                  "ec2:UnassignPrivateIpAddresses",
                ],
                Resource: "*",
              },
            ]),
      ],
    }),
  ),
});

const queueStatements = all([
  jobQueue.arn,
  jobDeadLetter.arn,
  apiRole.arn,
  host ? host.role.arn : apiRole.arn,
]).apply(([queueArn, deadLetterArn, producerArn, consumerArn]) => {
  const secure = (resource: string) => ({
    Effect: "Deny",
    Principal: "*",
    Action: "sqs:*",
    Resource: resource,
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  });
  const statements: Record<string, unknown>[] = [
    secure(queueArn),
    secure(deadLetterArn),
    {
      Effect: "Allow",
      Principal: { Service: "sqs.amazonaws.com" },
      Action: "sqs:SendMessage",
      Resource: deadLetterArn,
      Condition: { ArnEquals: { "aws:SourceArn": queueArn } },
    },
  ];
  if (!dev && host) {
    statements.push(
      {
        Effect: "Deny",
        Principal: "*",
        Action: ["sqs:SendMessage"],
        Resource: queueArn,
        Condition: {
          StringNotLike: { "aws:PrincipalArn": principalPatterns(producerArn) },
        },
      },
      {
        Effect: "Deny",
        Principal: "*",
        // GetQueueAttributes is omitted. Pulumi reads it while applying this
        // policy, and an explicit deny blocks the deploying user.
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
        ],
        Resource: queueArn,
        Condition: {
          StringNotLike: { "aws:PrincipalArn": principalPatterns(consumerArn) },
        },
      },
      {
        Effect: "Deny",
        Principal: "*",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
        ],
        Resource: deadLetterArn,
        Condition: {
          StringNotLike: { "aws:PrincipalArn": principalPatterns(consumerArn) },
        },
      },
    );
  }
  return JSON.stringify({ Version: "2012-10-17", Statement: statements });
});

new aws.sqs.QueuePolicy("JobQueuePolicy", {
  queueUrl: jobQueue.url,
  policy: queueStatements,
});
new aws.sqs.QueuePolicy("JobDeadLetterPolicy", {
  queueUrl: jobDeadLetter.url,
  policy: queueStatements,
});

export const api = new sst.aws.ApiGatewayV1("GoApi", {
  cors: true,
  transform: {
    api: {
      // Required for REST API + Lambda proxy binary download/upload.
      // Include */* so clients like Postman (Accept: */*) get binary decoding.
      binaryMediaTypes: [
        "*/*",
        "application/octet-stream",
        "image/jpeg",
        "image/png",
        "multipart/form-data",
      ],
    },
  },
});

function addRoute(route: string) {
  api.route(route, {
    handler: "packages/functions/cmd/goapi/main.go",
    runtime: "go",
    role: apiRole.arn,
    vpc: dev || !SupabaseVPC ? undefined : SupabaseVPC,
    link: [
      realtime,
      notifySecret,
      clerkSecret,
      clerkJWKSPublicKey,
      jobQueueLink,
      jobTableLink,
      resultBucketLink,
    ],
    environment: {
      APP_NAME: $app.name,
      APP_STAGE: $app.stage,
      JOB_QUEUE_URL: jobQueue.url,
      JOB_TABLE_NAME: jobTable.name,
      JOB_RESULT_BUCKET: resultBucket.name,
      APP_BUCKET: bucket.name,
    },
  });
}

addRoute("ANY /");
addRoute("ANY /{proxy+}");

api.deploy();

if (!dev && NatEip) {
  const policy = NatEip.publicIp.apply(function (ip) {
    console.log({ whitelistIp: ip });
    return JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: "*",
          Action: "execute-api:Invoke",
          Resource: "execute-api:/*",
        },
        {
          Effect: "Deny",
          Principal: "*",
          Action: "execute-api:Invoke",
          Resource: "execute-api:/*",
          Condition: {
            NotIpAddress: {
              "aws:SourceIp": [`${ip}/32`],
            },
          },
        },
      ],
    });
  });

  new aws.apigateway.RestApiPolicy("api-vpc-policy", {
    restApiId: api.nodes.api.id,
    policy,
  });
}

function principalPatterns(roleArn: string) {
  const name = roleArn.split("/").at(-1) ?? "";
  const accountId = roleArn.split(":")[4] ?? "";
  return [
    roleArn,
    `arn:aws:sts::${accountId}:assumed-role/${name}/*`,
  ];
}

function interpolateLogArn() {
  return all([identity.accountId]).apply(
    ([accountId]) =>
      `arn:aws:logs:ap-east-1:${accountId}:log-group:/aws/lambda/${$app.name}-${$app.stage}-*`,
  );
}
