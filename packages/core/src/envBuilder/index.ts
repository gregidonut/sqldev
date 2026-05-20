import { SpawnOptions, spawn } from "node:child_process";
import { Resource } from "sst";

//github.com/supabase/cli/issues/2588
const DOCKER_HOST = "unix:///var/run/docker.sock";
const CLERK_FE_DOMAIN = Resource.ClerkFeDomain.value;
const NOTIFY_IG_POST_VIEW_URL = Resource.igPostViewNotifier.url;

export function getSupabaseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DOCKER_HOST,
    CLERK_FE_DOMAIN,
    NOTIFY_IG_POST_VIEW_URL,
  };
}

export function runSupabase(args: string[], cwd = "./supabase") {
  const opts: SpawnOptions = {
    cwd,
    env: getSupabaseEnv(),
    stdio: "inherit",
  };

  const child = spawn("bunx", ["supabase", ...args], opts);
  child.on("exit", (code) => process.exit(code ?? 0));
}
