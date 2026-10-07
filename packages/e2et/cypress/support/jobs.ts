import { isRecord } from "../tasks/narrow.js";

export type FinishedJob = {
    status: string;
    result?: unknown;
    httpStatus?: number;
    error?: { message?: string };
};

export function waitForJob(jobId: string): Cypress.Chainable<FinishedJob> {
    const poll = (attempt: number): Cypress.Chainable<FinishedJob> =>
        cy.request(`/api/jobs/${jobId}`).then((response): Cypress.Chainable<FinishedJob> => {
            const body: unknown = response.body;
            if (!isRecord(body) || typeof body.status !== "string") {
                throw new Error("job status response was not an object");
            }
            if (body.status === "completed" || body.status === "failed") {
                return cy.wrap(body as FinishedJob, { log: false });
            }
            if (attempt >= 40) {
                throw new Error(`job ${jobId} did not finish`);
            }
            return cy.wait(250).then(() => poll(attempt + 1));
        });
    return poll(0);
}

export function jobIdFrom(body: unknown): string {
    if (!isRecord(body) || typeof body.jobId !== "string") {
        throw new Error("response is missing jobId");
    }
    return body.jobId;
}
