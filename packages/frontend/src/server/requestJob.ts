import axios, { type AxiosRequestConfig } from "axios";

export class JobFailedError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "JobFailedError";
        this.status = status;
    }
}

export type JobProgress = {
    readonly phase: "frames" | "encoding";
    readonly completed: number;
    readonly total: number;
};

export type JobRequestOptions = {
    readonly signal?: AbortSignal;
    readonly pollIntervalMs?: number;
    readonly onProgress?: (progress: JobProgress) => void;
};

type RunningJob = {
    readonly status: "pending" | "running";
    readonly progress?: JobProgress;
};

type CompletedJob = {
    readonly status: "completed";
    readonly result: unknown;
};

type FailedJob = {
    readonly status: "failed";
    readonly httpStatus: number;
    readonly message: string;
};

export async function requestJob<T>(
    config: AxiosRequestConfig,
    signalOrOptions?: AbortSignal | JobRequestOptions,
): Promise<T> {
    const options = jobOptions(signalOrOptions);
    const method = (config.method ?? "get").toUpperCase();
    const headers = new axios.AxiosHeaders(config.headers);
    if (
        method !== "GET" &&
        method !== "HEAD" &&
        !headers.has("Idempotency-Key")
    ) {
        headers.set("Idempotency-Key", crypto.randomUUID());
    }
    const response = await axios.request({
        ...config,
        headers,
        signal: options.signal,
        validateStatus: (status) =>
            status === 202 || (status >= 200 && status < 300),
    });
    if (response.status !== 202) {
        return response.data as T;
    }
    const jobId = readJobID(response.data);
    if (!jobId) {
        throw new JobFailedError(502, "job receipt is missing an id");
    }
    return pollJob<T>(jobId, options);
}

function jobOptions(
    value: AbortSignal | JobRequestOptions | undefined,
): JobRequestOptions {
    if (value instanceof AbortSignal) {
        return { signal: value };
    }
    return value ?? {};
}

async function pollJob<T>(
    jobId: string,
    options: JobRequestOptions,
): Promise<T> {
    const delays = [200, 400, 800, 1200, 1600, 2000];
    for (let attempt = 0; attempt < 60; attempt += 1) {
        throwIfAborted(options.signal);
        const { data } = await axios.get<unknown>(`/api/jobs/${jobId}`, {
            signal: options.signal,
        });
        const job = parseJob(data);
        if (job.status === "completed") {
            return job.result as T;
        }
        if (job.status === "failed") {
            throw new JobFailedError(job.httpStatus, job.message);
        }
        if (job.progress) {
            options.onProgress?.(job.progress);
        }
        const delay =
            options.pollIntervalMs ??
            delays[Math.min(attempt, delays.length - 1)] ??
            2000;
        await wait(delay, options.signal);
    }
    throw new JobFailedError(504, "job timed out");
}

function parseJob(value: unknown): RunningJob | CompletedJob | FailedJob {
    if (!isRecord(value) || typeof value.status !== "string") {
        throw new JobFailedError(502, "job response is invalid");
    }
    if (value.status === "pending" || value.status === "running") {
        return {
            status: value.status,
            progress: parseProgress(value.progress),
        };
    }
    if (value.status === "completed") {
        return { status: "completed", result: value.result };
    }
    if (value.status === "failed") {
        const message =
            isRecord(value.error) && typeof value.error.message === "string"
                ? value.error.message
                : "job failed";
        return {
            status: "failed",
            httpStatus:
                typeof value.httpStatus === "number" ? value.httpStatus : 500,
            message,
        };
    }
    throw new JobFailedError(502, "job response is invalid");
}

function parseProgress(value: unknown): JobProgress | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (
        !isRecord(value) ||
        (value.phase !== "frames" && value.phase !== "encoding") ||
        !isWholeNumber(value.completed) ||
        !isWholeNumber(value.total) ||
        value.total < 1 ||
        value.completed > value.total
    ) {
        return undefined;
    }
    return {
        phase: value.phase,
        completed: value.completed,
        total: value.total,
    };
}

function readJobID(value: unknown): string | undefined {
    if (
        !isRecord(value) ||
        typeof value.jobId !== "string" ||
        value.jobId.length === 0
    ) {
        return undefined;
    }
    return value.jobId;
}

function isWholeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(
                    new DOMException("The operation was aborted", "AbortError"),
                );
            },
            { once: true },
        );
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
    }
}
