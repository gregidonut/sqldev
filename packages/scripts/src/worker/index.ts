import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Resource } from "sst";

const resources = Resource as unknown as {
    JobQueueUrl: { url: string };
    JobStatusName: { name: string };
    JobResultBucketName: { name: string };
    SQLDevBucket: { name: string };
};

const child = spawn("go", ["run", "./cmd/supabaseworker"], {
    cwd: fileURLToPath(new URL("../../../functions/", import.meta.url)),
    stdio: "inherit",
    env: {
        ...process.env,
        CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
        AWS_REGION: process.env.AWS_REGION ?? "ap-east-1",
        APP_NAME: process.env.APP_NAME ?? "sqldev",
        APP_STAGE: process.env.STAGE ?? process.env.SST_STAGE ?? "dev",
        JOB_QUEUE_URL: resources.JobQueueUrl.url,
        JOB_TABLE_NAME: resources.JobStatusName.name,
        JOB_RESULT_BUCKET: resources.JobResultBucketName.name,
        APP_BUCKET: resources.SQLDevBucket.name,
        DBOS_SYSTEM_DATABASE_URL:
            process.env.DBOS_SYSTEM_DATABASE_URL ??
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
    },
});

child.on("exit", (code) => process.exit(code ?? 1));
