import { randomUUID } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNodeError } from "./narrow.js";

const lockPath = join(tmpdir(), "sqldev-e2et-backend.lock");

let releaseOnExit = false;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return isNodeError(err) && err.code === "EPERM";
  }
}

function readLock(): { pid: number; runId: string } | undefined {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
  const [pidText, runId = ""] = text.split("\n");
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  return { pid, runId };
}

function installExitRelease(): void {
  if (releaseOnExit) {
    return;
  }
  releaseOnExit = true;
  process.on("exit", () => {
    releaseRunLock();
  });
}

export function createRunId(): string {
  return randomUUID();
}

/**
 * One Cypress process may reset the shared local Supabase project. A second
 * process fails instead of truncating the first process's rows.
 */
export function acquireRunLock(runId: string): void {
  const payload = `${process.pid}\n${runId}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      installExitRelease();
      return;
    } catch (err) {
      if (!isNodeError(err) || err.code !== "EEXIST") {
        throw err;
      }
    }

    const existing = readLock();
    if (
      existing &&
      existing.pid !== process.pid &&
      pidAlive(existing.pid)
    ) {
      throw new Error(
        `Another Cypress process (pid ${existing.pid}, run ${existing.runId}) holds ${lockPath}. Refusing to reset the shared local Supabase project.`,
      );
    }

    try {
      unlinkSync(lockPath);
    } catch (err) {
      if (!isNodeError(err) || err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  throw new Error(`Could not acquire ${lockPath}`);
}

export function releaseRunLock(): void {
  const existing = readLock();
  if (!existing || existing.pid !== process.pid) {
    return;
  }
  try {
    unlinkSync(lockPath);
  } catch (err) {
    if (!isNodeError(err) || err.code !== "ENOENT") {
      throw err;
    }
  }
}
