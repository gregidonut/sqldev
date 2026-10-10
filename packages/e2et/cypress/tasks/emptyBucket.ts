import { parseDeleted, runSqldev } from "./sqldevCli.js";

export async function emptyBucket(): Promise<{ deleted: number }> {
  const { stdout } = await runSqldev(["--output", "json", "storage", "empty", "--yes"]);
  return { deleted: parseDeleted(stdout) };
}
