import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNodeError, isRecord } from "./narrow.js";

const supabaseDir = fileURLToPath(
  new URL("../../../backend/supabase", import.meta.url),
);
const configPath = join(supabaseDir, "config.toml");

const LOCAL_STAGES = new Set(["dev", "local", "development"]);

/**
 * Explicit test-owned tables. Lookup tables such as `*_permissions` stay.
 * No CASCADE: a new foreign key should fail this reset instead of being erased.
 * No RESTART IDENTITY: these tables use UUID primary keys.
 */
const TEST_TABLES = [
  "public.users",
  "public.user_status",
  "public.ig_posts",
  "public.ig_bio",
  "public.ig_followers",
  "public.ig_hashtags",
  "public.ig_mentions",
  "public.ig_post_attachment_info",
  "public.ig_post_comment_attachment_info",
  "public.ig_post_comment_likes",
  "public.ig_post_comment_text_content",
  "public.ig_post_comments",
  "public.ig_post_config",
  "public.ig_post_likes",
  "public.ig_post_text_content",
  "public.ig_posts_roles",
  "public.tds_todo_spaces",
  "public.tds_todo_space_data",
  "public.tds_todo_items",
  "public.tds_todo_item_data",
  "public.tds_todo_space_config",
  "public.tds_todo_spaces_roles",
  "public.d_storage_objects",
  "public.d_storage_object_data",
  "public.d_storage_object_config",
  "public.d_storage_objects_roles",
] as const;

const TRUNCATE_SQL = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
TRUNCATE TABLE
${TEST_TABLES.map((table) => `  ${table}`).join(",\n")};
COMMIT;
`;

export function assertLocalDevStage(): string {
  const stage = process.env.STAGE ?? process.env.SST_STAGE;
  if (!stage || !LOCAL_STAGES.has(stage) || /prod/i.test(stage)) {
    throw new Error(
      `Refusing to reset local test data for stage ${stage ?? "(missing)"}. Expected dev, local, or development.`,
    );
  }
  return stage;
}

function readTomlPort(toml: string, section: string): number | undefined {
  let inSection = false;
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\[([^\]]+)\]/.exec(line.trim());
    if (header) {
      inSection = header[1] === section;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const port = /^port\s*=\s*(\d+)\s*$/.exec(line.trim());
    if (port?.[1]) {
      return Number(port[1]);
    }
  }
  return undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function assertLoopback(url: URL, label: string): void {
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(`Refusing non-loopback ${label} host ${url.hostname}`);
  }
}

function sameLoopbackEndpoint(left: URL, right: URL): boolean {
  return (
    left.protocol === right.protocol &&
    left.port === right.port &&
    isLoopbackHost(left.hostname) &&
    isLoopbackHost(right.hostname)
  );
}

function assertLocalApiUrl(supabaseUrl: string, apiPort: number): URL {
  const url = new URL(supabaseUrl);
  assertLoopback(url, "SUPABASE_URL");
  if (Number(url.port) !== apiPort) {
    throw new Error(
      `Refusing SUPABASE_URL port ${url.port || "(default)"}; expected local api port ${apiPort} from config.toml`,
    );
  }
  return url;
}

function assertDirectLocalDbUrl(
  dbUrl: string,
  dbPort: number,
  poolerPort: number | undefined,
): URL {
  const url = new URL(dbUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Refusing non-postgres database URL from supabase status");
  }
  assertLoopback(url, "database");
  const port = Number(url.port);
  if (poolerPort !== undefined && port === poolerPort) {
    throw new Error(
      "Refusing to truncate through the transaction pooler. Use the direct local database port.",
    );
  }
  if (port !== dbPort) {
    throw new Error(
      `Refusing database port ${url.port || "(default)"}; expected direct local db port ${dbPort} from config.toml`,
    );
  }
  return url;
}

function spawnText(
  command: string,
  args: readonly string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      if (isNodeError(err) && err.code === "ENOENT") {
        reject(new Error(`${command} was not found on PATH`));
        return;
      }
      reject(err);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(`${command} exited with code ${code ?? 1}\n${stderr}`),
      );
    });
  });
}

function parseJsonObject(stdout: string): unknown {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("supabase status did not return JSON");
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

function statusString(payload: unknown, names: readonly string[]): string {
  if (!isRecord(payload)) {
    throw new Error("supabase status JSON was not an object");
  }
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `supabase status JSON is missing ${names.join(" or ")}`,
  );
}

function redact(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[redacted]");
}

export async function truncateLocalTestData(): Promise<null> {
  assertLocalDevStage();

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required to verify the local API target");
  }

  const toml = readFileSync(configPath, "utf8");
  const apiPort = readTomlPort(toml, "api");
  const dbPort = readTomlPort(toml, "db");
  const poolerPort = readTomlPort(toml, "db.pooler");
  if (apiPort === undefined || dbPort === undefined) {
    throw new Error("config.toml is missing [api].port or [db].port");
  }

  const apiUrl = assertLocalApiUrl(supabaseUrl, apiPort);
  const { stdout } = await spawnText(
    "bunx",
    ["supabase", "status", "-o", "json", "--yes"],
    supabaseDir,
  );
  const status = parseJsonObject(stdout);
  const statusApiUrl = statusString(status, ["API_URL", "api_url"]);
  const dbUrl = statusString(status, ["DB_URL", "db_url"]);

  const statusApi = new URL(statusApiUrl);
  assertLoopback(statusApi, "supabase status API_URL");
  if (!sameLoopbackEndpoint(statusApi, apiUrl)) {
    throw new Error(
      `supabase status API origin ${statusApi.origin} does not match SUPABASE_URL origin ${apiUrl.origin}`,
    );
  }

  assertDirectLocalDbUrl(dbUrl, dbPort, poolerPort);

  try {
    await spawnText("psql", [
      "-d",
      dbUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      TRUNCATE_SQL,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "psql failed";
    throw new Error(redact(message, dbUrl));
  }

  return null;
}
