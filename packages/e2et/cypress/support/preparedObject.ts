import { isRecord } from "../tasks/narrow.js";

export function rememberPreparedObject(body: unknown): Cypress.Chainable<null> {
  if (!isRecord(body)) {
    throw new Error("presign response was not an object");
  }
  const key = body.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("presign response is missing key");
  }
  if (!isRecord(body.pendingUpload)) {
    throw new Error("presign response is missing pendingUpload");
  }
  const storageObjectId = body.pendingUpload.storageObjectId;
  const s3ObjectKey = body.pendingUpload.s3ObjectKey;
  if (typeof storageObjectId !== "string" || storageObjectId.length === 0) {
    throw new Error("presign response is missing storageObjectId");
  }
  if (typeof s3ObjectKey !== "string" || s3ObjectKey !== key) {
    throw new Error("presign key does not match pendingUpload.s3ObjectKey");
  }

  return cy.task("registerPreparedObject", { storageObjectId, s3ObjectKey });
}
