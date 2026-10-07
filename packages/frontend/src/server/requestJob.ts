import axios, { type AxiosRequestConfig } from "axios";

export class JobFailedError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "JobFailedError";
        this.status = status;
    }
}

type JobState = {
    status: "pending" | "running" | "completed" | "failed";
    result?: unknown;
    error?: { message?: string };
    httpStatus?: number;
};

export async function requestJob<T>(
    config: AxiosRequestConfig,
    signal?: AbortSignal,
): Promise<T> {
    const method = (config.method ?? "get").toUpperCase();
    const headers = new axios.AxiosHeaders(config.headers);
    if (method !== "GET" && method !== "HEAD" && !headers.has("Idempotency-Key")) {
        headers.set("Idempotency-Key", crypto.randomUUID());
    }
    const response = await axios.request({
        ...config,
        headers,
        signal,
        validateStatus: (status) =>
            status === 202 || (status >= 200 && status < 300),
    });
    if (response.status !== 202) {
        return response.data as T;
    }
    const jobId = (response.data as { jobId?: string }).jobId;
    if (!jobId) {
        throw new JobFailedError(502, "job receipt is missing an id");
    }
    return pollJob<T>(jobId, signal);
}

async function pollJob<T>(jobId: string, signal?: AbortSignal): Promise<T> {
    const delays = [200, 400, 800, 1200, 1600, 2000];
    for (let attempt = 0; attempt < 60; attempt += 1) {
        throwIfAborted(signal);
        const { data } = await axios.get<JobState>(`/api/jobs/${jobId}`, {
            signal,
        });
        if (data.status === "completed") {
            return data.result as T;
        }
        if (data.status === "failed") {
            throw new JobFailedError(
                data.httpStatus ?? 500,
                data.error?.message ?? "job failed",
            );
        }
        await wait(delays[Math.min(attempt, delays.length - 1)] ?? 2000, signal);
    }
    throw new JobFailedError(504, "job timed out");
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("The operation was aborted", "AbortError"));
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
