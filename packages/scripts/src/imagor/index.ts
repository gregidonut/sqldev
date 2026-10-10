import { spawn } from "node:child_process";
import { Resource } from "sst";

const resources = Resource as unknown as {
    SQLDevBucket: { name: string };
};

const image = process.env.IMAGOR_IMAGE ?? "sqldev-imagor:test";
const secret = process.env.IMAGOR_SECRET || "local-dev-secret";
const bucket = resources.SQLDevBucket.name;

const envArgs = [
    "SERVER_ADDRESS=0.0.0.0",
    "PORT=8000",
    `IMAGOR_SECRET=${secret}`,
    "IMAGOR_SIGNER_TYPE=sha256",
    "IMAGOR_SIGNER_TRUNCATE=40",
    "IMAGOR_DISABLE_PARAMS_ENDPOINT=1",
    "HTTP_LOADER_DISABLE=1",
    "FFMPEG_MAX_ANIMATION_FRAMES=18",
    // Keep in step with VIPS_MAX_RESOLUTION in packages/backend/selfhost/bootstrap.sh.
    "VIPS_MAX_RESOLUTION=67108864",
    "AWS_REGION=ap-east-1",
    `S3_LOADER_BUCKET=${bucket}`,
    "S3_SAFE_CHARS=--",
];
for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
    const value = process.env[name];
    if (value) {
        envArgs.push(`${name}=${value}`);
    }
}

const remove = spawn("docker", ["rm", "-f", "sqldev-imagor"], { stdio: "inherit" });
remove.on("exit", () => {
    const args = [
        "run",
        "--rm",
        "--name",
        "sqldev-imagor",
        "-p",
        "127.0.0.1:8000:8000",
    ];
    for (const entry of envArgs) {
        args.push("-e", entry);
    }
    args.push(image);
    const child = spawn("docker", args, { stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 1));
});
