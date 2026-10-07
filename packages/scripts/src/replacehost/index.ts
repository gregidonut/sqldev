import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Replaces the Supabase host so the data volume can be checked after a new
// instance boots. The root disk is deleted with the instance. The data disk is
// only detached, then SST attaches it to the replacement.
const stage = process.env.STAGE ?? process.env.SST_STAGE;
if (!stage || stage === "dev") {
    throw new Error("replacehost needs a deployed stage; dev has no host");
}

type Mapping = {
    DeviceName: string;
    Ebs?: { VolumeId: string };
};

type Instance = {
    InstanceId: string;
    RootDeviceName: string;
    BlockDeviceMappings?: Mapping[];
};

const hostName = `sqldev-${stage}-supabase`;
const previous = runningInstance();
const dataVolumeId = previous ? dataVolume(previous) : undefined;
if (previous && dataVolumeId) {
    console.log(`replacing ${hostName} (${previous.InstanceId}), keeping ${dataVolumeId}`);
    aws(["ec2", "terminate-instances", "--instance-ids", previous.InstanceId]);
    aws(["ec2", "wait", "instance-terminated", "--instance-ids", previous.InstanceId]);
} else {
    console.log(`no running ${hostName}; deploying a replacement`);
}

const root = fileURLToPath(new URL("../../../../", import.meta.url));
runSst("refresh", root);
runSst("deploy", root);

const next = runningInstance();
if (!next) {
    throw new Error(`deploy finished without a running ${hostName}`);
}
const attached = dataVolume(next);
if (dataVolumeId && attached !== dataVolumeId) {
    throw new Error(
        `${next.InstanceId} is not attached to ${dataVolumeId}`,
    );
}
console.log(
    `replaced ${previous?.InstanceId ?? "none"} with ${next.InstanceId}; ${attached} is attached`,
);

function runningInstance(): Instance | undefined {
    const described = JSON.parse(
        aws([
            "ec2",
            "describe-instances",
            "--filters",
            `Name=tag:Name,Values=${hostName}`,
            "Name=instance-state-name,Values=running",
            "--output",
            "json",
        ]),
    ) as { Reservations?: { Instances?: Instance[] }[] };
    const instance = described.Reservations?.[0]?.Instances?.[0];
    if (!instance?.InstanceId.startsWith("i-")) {
        return undefined;
    }
    return instance;
}

function dataVolume(instance: Instance): string {
    const volumes = (instance.BlockDeviceMappings ?? []).filter(
        (mapping) =>
            mapping.DeviceName !== instance.RootDeviceName &&
            mapping.Ebs?.VolumeId.startsWith("vol-"),
    );
    if (volumes.length !== 1) {
        throw new Error(
            `${instance.InstanceId} has ${volumes.length} data volumes; expected 1`,
        );
    }
    return volumes[0].Ebs!.VolumeId;
}

function aws(args: string[]): string {
    return execFileSync("aws", args, { encoding: "utf8" });
}

function runSst(command: "refresh" | "deploy", cwd: string) {
    const result = spawnSync("bunx", ["sst", command, "--stage", stage!], {
        cwd,
        stdio: "inherit",
    });
    if (result.status !== 0) {
        throw new Error(`sst ${command} exited with ${result.status ?? "signal"}`);
    }
}
