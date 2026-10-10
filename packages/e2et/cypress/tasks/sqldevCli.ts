import { spawn } from "node:child_process";
import { isNodeError } from "./narrow.js";

/**
 * The sqldev CLI binary. Cypress is launched through `sqldev cypress`, which
 * injects SQLDEV_BIN as the absolute path to the running binary so these tasks
 * can call back into it for storage and Supabase work.
 */
function sqldevBin(): string {
  const bin = process.env.SQLDEV_BIN;
  if (!bin) {
    throw new Error(
      "SQLDEV_BIN is not set. Run Cypress through `sqldev cypress ...` so the CLI injects it.",
    );
  }
  return bin;
}

interface RunResult {
  stdout: string;
}

/**
 * Runs the sqldev CLI with the given arguments, inheriting the current
 * environment. stdout is captured so JSON output can be parsed; stderr is
 * inherited so failures are visible. Rejects on a non-zero exit.
 */
export function runSqldev(args: readonly string[]): Promise<RunResult> {
  const bin = sqldevBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", (err) => {
      if (isNodeError(err) && err.code === "ENOENT") {
        reject(new Error(`sqldev binary ${bin} was not found`));
        return;
      }
      reject(err);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout });
        return;
      }
      reject(new Error(`sqldev ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

/** Parses a `{ "deleted": number }` JSON object from sqldev --output json. */
export function parseDeleted(stdout: string): number {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("sqldev did not return JSON");
  }
  const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { deleted?: unknown }).deleted !== "number"
  ) {
    throw new Error("sqldev JSON is missing a numeric 'deleted' field");
  }
  return (parsed as { deleted: number }).deleted;
}
