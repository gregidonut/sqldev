import { execFileSync, spawn } from "node:child_process";

// Forwards a local port to Postgres on the private host through SSM. The host
// has no SSH key or inbound rule, and Postgres listens only on its 127.0.0.1.
const stage = process.env.STAGE ?? process.env.SST_STAGE;
if (!stage || stage === "dev") {
    throw new Error("hostdb needs a deployed stage; dev has no host");
}
const localPort = process.env.LOCAL_PORT ?? "15432";
const hostName = `sqldev-${stage}-supabase`;

const instanceId = execFileSync(
    "aws",
    [
        "ec2",
        "describe-instances",
        "--filters",
        `Name=tag:Name,Values=${hostName}`,
        "Name=instance-state-name,Values=running",
        "--query",
        "Reservations[0].Instances[0].InstanceId",
        "--output",
        "text",
    ],
    { encoding: "utf8" },
).trim();
if (!instanceId.startsWith("i-")) {
    throw new Error(`no running instance named ${hostName}`);
}

console.log(`${hostName} (${instanceId}) postgres -> 127.0.0.1:${localPort}`);
const child = spawn(
    "aws",
    [
        "ssm",
        "start-session",
        "--target",
        instanceId,
        "--document-name",
        "AWS-StartPortForwardingSession",
        "--parameters",
        JSON.stringify({ portNumber: ["5432"], localPortNumber: [localPort] }),
    ],
    { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
