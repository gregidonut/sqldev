import React from "react";
import { AxiosError } from "axios";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
});

export function formatTimestamp(value: string): string {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? value
        : timestampFormatter.format(parsed);
}

function proxyMessage(payload: unknown): string | null {
    if (typeof payload !== "object" || payload === null) {
        return null;
    }
    const message = (payload as { message?: unknown }).message;
    return typeof message === "string" && message.length > 0 ? message : null;
}

export function toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof AxiosError) {
        return proxyMessage(error.response?.data) ?? error.message ?? fallback;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallback;
}

export function VisibilityBadge({ isPublic }: { isPublic: boolean }) {
    return (
        <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                isPublic
                    ? "border-drac-green/40 bg-drac-green/15 text-drac-green"
                    : "border-drac-comment/50 bg-drac-selection text-drac-foreground"
            } forced-colors:border-[ButtonBorder] forced-colors:bg-[Canvas] forced-colors:text-[ButtonText]`}
        >
            {isPublic ? "Public" : "Private"}
        </span>
    );
}
