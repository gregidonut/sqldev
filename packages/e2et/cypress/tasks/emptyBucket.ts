import { parseDeleted, runSqldev } from "./sqldevCli.js";
import { currentStage, isLocalStage } from "./stage.js";

/**
 * Manual maintenance task that empties the whole SQLDevBucket. It is strictly
 * local-only: on a deployed stage such as staging it refuses, so a spec can
 * never independently wipe the shared staging bucket. Coordinated staging
 * cleanup goes through `sqldev e2e reset`, not this task.
 */
export async function emptyBucket(): Promise<{ deleted: number }> {
  const stage = currentStage();
  if (!isLocalStage(stage)) {
    throw new Error(
      `Refusing whole-bucket emptyBucket for stage ${stage || "(missing)"}; it is permitted only on local stages (dev, local, development).`,
    );
  }
  const { stdout } = await runSqldev(["--output", "json", "storage", "empty", "--yes"]);
  return { deleted: parseDeleted(stdout) };
}
