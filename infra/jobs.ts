export const jobDeadLetter = new sst.aws.Queue("JobDeadLetter", {
  transform: {
    queue: (args) => {
      args.sqsManagedSseEnabled = true;
    },
  },
});

export const jobQueue = new sst.aws.Queue("JobQueue", {
  visibilityTimeout: "2 minutes",
  dlq: {
    queue: jobDeadLetter.arn,
    retry: 3,
  },
  transform: {
    queue: (args) => {
      args.sqsManagedSseEnabled = true;
    },
  },
});

export const jobTable = new sst.aws.Dynamo("JobStatus", {
  fields: {
    jobId: "string",
  },
  primaryIndex: { hashKey: "jobId" },
  ttl: "expiresAt",
});

export const resultBucket = new sst.aws.Bucket("JobResultBucket", {
  lifecycle: [
    {
      id: "expire-job-results",
      expiresIn: "1 day",
    },
  ],
});

// Property-only links. The queue component's own link grants sqs:*, so callers
// receive names through these links and IAM stays on the roles that need it.
export const jobQueueLink = new sst.Linkable("JobQueueUrl", {
  properties: { url: jobQueue.url },
});

export const jobTableLink = new sst.Linkable("JobStatusName", {
  properties: { name: jobTable.name },
});

export const resultBucketLink = new sst.Linkable("JobResultBucketName", {
  properties: { name: resultBucket.name },
});
