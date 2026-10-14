import { isRecord } from "./narrow.js";
import { currentStage } from "./stage.js";
import { runSqldev } from "./sqldevCli.js";

export interface PreparedObjectRef {
  storageObjectId: string;
  s3ObjectKey: string;
}

const prepared: PreparedObjectRef[] = [];

export function registerPreparedObject(body: unknown): null {
  if (!isRecord(body)) {
    throw new Error("prepared object was not an object");
  }
  const storageObjectId = body.storageObjectId;
  const s3ObjectKey = body.s3ObjectKey;
  if (typeof storageObjectId !== "string" || storageObjectId.length === 0) {
    throw new Error("prepared object is missing storageObjectId");
  }
  if (typeof s3ObjectKey !== "string" || s3ObjectKey.length === 0) {
    throw new Error("prepared object is missing s3ObjectKey");
  }
  const next = { storageObjectId, s3ObjectKey };
  const known = prepared.some(
    (entry) => entry.s3ObjectKey === next.s3ObjectKey,
  );
  if (!known) {
    prepared.push(next);
  }
  return null;
}

export async function deleteRegisteredObjects(): Promise<null> {
  const keys = prepared.map((entry) => entry.s3ObjectKey);
  if (keys.length === 0) {
    return null;
  }
  // Exact-key cleanup is allowed on dev and staging but never on production.
  // The underlying `sqldev storage delete` also refuses exact prod/production.
  const stage = currentStage();
  if (/prod/i.test(stage)) {
    throw new Error(
      `Refusing prepared-object cleanup for production-like stage ${stage}.`,
    );
  }
  await runSqldev(["--output", "json", "storage", "delete", "--", ...keys]);
  prepared.length = 0;
  return null;
}
