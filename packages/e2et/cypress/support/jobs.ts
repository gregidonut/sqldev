import { isRecord } from "../tasks/narrow.js";

export type FinishedJob = {
    status: string;
    result?: unknown;
    httpStatus?: number;
    error?: { message?: string };
};

export function waitForJob(jobId: string): Cypress.Chainable<FinishedJob> {
    const poll = (attempt: number): Cypress.Chainable<FinishedJob> =>
        cy.request({ url: `/api/jobs/${jobId}`, failOnStatusCode: false }).then((response): Cypress.Chainable<FinishedJob> => {
            if (isTransientStatus(response.status)) {
                if (attempt >= 40) {
                    throw new Error(`job ${jobId} poll kept failing with ${response.status}`);
                }
                return cy.wait(250).then(() => poll(attempt + 1));
            }
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`job ${jobId} poll returned ${response.status}`);
            }
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

/** Lambda throttling on staging returns 429, or 5xx through API Gateway and CloudFront. */
function isTransientStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 504);
}

export function jobIdFrom(body: unknown): string {
    if (!isRecord(body) || typeof body.jobId !== "string") {
        throw new Error("response is missing jobId");
    }
    return body.jobId;
}
