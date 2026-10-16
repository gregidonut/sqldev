// Helpers for specs that need a stored drive object. They mirror the upload
// helpers private to drive.cy.ts, kept here so a second spec can share them
// without editing the first.
import { isRecord } from "../tasks/narrow.js";
import { jobIdFrom, waitForJob } from "./jobs.js";
import { rememberPreparedObject } from "./preparedObject.js";

/** Small enough to upload quickly, large enough to compare byte for byte. */
export const SMALL_IMAGE = "cypress/fixtures/testFiles/WIN_20260102_21_30_21_Pro.jpg";

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The fixture uploaded under a unique name so parallel runs never collide. */
export function namedFixture(
  path: string,
  marker: string,
): { contents: string; fileName: string } {
  const base = fileNameOf(path);
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot) : "";
  return { contents: path, fileName: `${stem}-${marker}${ext}` };
}

export function bucketNameFrom(url: string): string {
  const match = url.match(/\/api\/storage\/buckets\/([^/]+)\/objects/);
  if (!match?.[1]) {
    throw new Error("storage request is missing a bucket");
  }
  return decodeURIComponent(match[1]);
}

export function objectsGrid() {
  return cy.get("[data-cy='dStorage_objects']:visible", { timeout: 20000 });
}

/** The visible row (table row, list item or tile) for one file. */
export function rowFor(fileName: string) {
  return objectsGrid().contains("[data-cy='dStorage_item']", fileName);
}

/** The row's actions button, the element focus must return to. */
export function actionsButton(fileName: string) {
  return rowFor(fileName).find(`button[aria-label="Actions for ${fileName}"]`);
}

export function openActions(fileName: string) {
  actionsButton(fileName).click();
}

/**
 * Signs in and opens a drive tab, registering the list intercept before the
 * visit so the first list request can be awaited. Alias: @listObjects.
 */
export function openDrive(user: 0 | 1, tab: "mine" | "public" | "shared_with_me") {
  cy.signInAsUser(user);
  cy.intercept({
    method: "GET",
    url: /\/api\/storage\/buckets\/[^/]+\/objects\?/,
  }).as("listObjects");
  cy.intercept({
    method: "POST",
    url: /\/api\/storage\/buckets\/[^/]+\/objects\/presign(\?|$)/,
  }).as("presignObject");
  cy.intercept({
    method: "POST",
    url: /\/api\/storage\/buckets\/[^/]+\/objects\/commit$/,
  }).as("commitObject");
  cy.visit(`/drive/${tab}`);
  cy.waitForClerkLoaded();
  objectsGrid().should("exist");
  cy.wait("@listObjects");
}

function waitForAccepted(alias: `@${string}`) {
  cy.wait(alias, { timeout: 60000 }).then((interception) => {
    expect(interception.response?.statusCode).to.eq(202);
    return waitForJob(jobIdFrom(interception.response?.body)).then((job) => {
      expect(job.status).to.eq("completed");
    });
  });
}

/** Uploads one file through the dialog and waits until its row is listed. */
export function uploadThroughDialog(file: { contents: string; fileName: string }) {
  cy.get("[data-cy='dStorage_upload']").click();
  cy.get("[role='dialog'] input[type='file']").selectFile([file], { force: true });
  cy.get("[data-cy='dStorage_upload_submit']").click();

  cy.wait("@presignObject", { timeout: 60000 }).then((interception) => {
    expect(interception.response?.statusCode).to.eq(202);
    return waitForJob(jobIdFrom(interception.response?.body)).then((job) => {
      expect(job.status).to.eq("completed");
      return rememberPreparedObject(job.result);
    });
  });
  waitForAccepted("@commitObject");

  cy.get("[role='dialog']", { timeout: 20000 }).should("not.exist");
  cy.wait("@listObjects", { timeout: 20000 });
  objectsGrid().should("contain", file.fileName);
}

export type StoredObject = {
  storageObjectId: string;
  configVersion: number;
  isPublic: boolean;
  s3ObjectKey: string;
};

/** Reads one of the caller's own rows through the API, as the page does. */
export function readOwnRow(bucket: string, fileName: string): Cypress.Chainable<StoredObject> {
  return cy
    .request(`/api/storage/buckets/${encodeURIComponent(bucket)}/objects?tab=mine`)
    .then((response) =>
      waitForJob(jobIdFrom(response.body)).then((job) => {
        expect(job.status).to.eq("completed");
        const rows: unknown = job.result;
        if (!Array.isArray(rows)) {
          throw new Error("list result was not an array");
        }
        const row = rows.find((r) => isRecord(r) && r.file_name === fileName);
        if (
          !isRecord(row) ||
          typeof row.storage_object_id !== "string" ||
          typeof row.config_version !== "number" ||
          typeof row.public !== "boolean" ||
          typeof row.s3_object_key !== "string"
        ) {
          throw new Error(`no complete row for ${fileName}`);
        }
        return {
          storageObjectId: row.storage_object_id,
          configVersion: row.config_version,
          isPublic: row.public,
          s3ObjectKey: row.s3_object_key,
        };
      }),
    );
}
