import {ChildProcess, SpawnOptions, spawn} from "node:child_process";
import {Resource} from "sst";

//github.com/supabase/cli/issues/2588
const DOCKER_HOST = "unix:///var/run/docker.sock";
const CLERK_FE_DOMAIN = Resource.ClerkFeDomain.value;

export enum cmd {
    start = "start",
    stop = "stop",
    status = "status",
    genTypes = "genTypes",
    reset = "reset",
    diff = "diff",
    dump = "dump",
}

export default function (c: cmd) {
    let supabase: ChildProcess;
    const opts: SpawnOptions = {
        cwd: "./supabase",
        env: {
            ...process.env,
            DOCKER_HOST,
            CLERK_FE_DOMAIN,
        },
        stdio: "inherit",
    };

    switch (c) {
        case cmd.genTypes:
            supabase = spawn(
                "bunx",
                [
                    "supabase",
                    "gen",
                    "types",
                    "typescript",
                    "--schema",
                    "public",
                    "--local",
                ],
                opts,
            );
            break;
        case cmd.diff:
            supabase = spawn(
                "bunx",
                ["supabase", "db", "diff", "--local", "-f", "init"],
                opts,
            );
            break;
        case cmd.dump:
            supabase = spawn(
                "bunx",
                [
                    "supabase",
                    "db",
                    "dump",
                    "--local",
                    "--data-only",
                    "--file=supabase/seed.sql",
                ],
                opts,
            );
            break;
        case cmd.reset:
            supabase = spawn("bunx", ["supabase", "db", "reset"], opts);
            break;
        default:
            supabase = spawn("bunx", ["supabase", c], opts);
    }
    supabase.on("exit", function (code) {
        process.exit(code ?? 0);
    });
}
