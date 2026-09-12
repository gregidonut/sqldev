import { SpawnOptions, spawn } from "node:child_process";
import { Resource } from "sst";

//github.com/supabase/cli/issues/2588
// const DOCKER_HOST = "unix:///var/run/docker.sock";
const CLERK_FE_DOMAIN = Resource.ClerkFeDomain.value;
const NOTIFY_SECRET = Resource.NotifySecret.value;
const NOTIFY_IG_POSTS_VIEW_URL = Resource.GoApi.url + "notify";
const RENDER_MD_URL = Resource.GoApi.url + "renderMd";
const CLERK_PUBLISHABLE_KEY = Resource.ClerkPublicKey.value;
const CLERK_SECRET_KEY = Resource.ClerkSecretKey.value;
const SUPABASE_URL = Resource.SupabaseUrl.value;
const SUPABASE_KEY = Resource.SupabaseKey.value;

export function getSupabaseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // DOCKER_HOST,
    CLERK_FE_DOMAIN,
    NOTIFY_IG_POSTS_VIEW_URL,
    RENDER_MD_URL,
    NOTIFY_SECRET,
  };
}

export function runSupabase(args: string[], cwd = "./supabase"): Promise<void> {
  const opts: SpawnOptions = {
    cwd,
    env: getSupabaseEnv(),
    stdio: "inherit",
  };

  return new Promise((resolve, reject) => {
    const child = spawn("bunx", ["supabase", ...args], opts);
    child.on("error", reject);
    child.on("exit", (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`supabase ${args.join(" ")} exited with code ${code ?? 1}`),
      );
    });
  });
}

export function getCypressEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY,
    SUPABASE_URL,
    SUPABASE_KEY,
  };
}

export function runCypress(args: string[], cwd = ".") {
  const opts: SpawnOptions = {
    cwd,
    env: getCypressEnv(),
    stdio: "inherit",
  };

  const child = spawn("bunx", ["cypress", ...args], opts);
  child.on("exit", (code) => process.exit(code ?? 0));
}
