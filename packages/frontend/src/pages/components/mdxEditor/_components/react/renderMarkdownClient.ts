/**
 * Browser render client for the MDX Editor Demo.
 *
 * Sends the submitted Markdown to the authenticated same-origin endpoint
 * `/api/renderMd` and validates the response before producing a branded
 * {@link SanitizedHtml} value. The brand records that the HTML came from a
 * successfully validated server response; it never makes an arbitrary string
 * safe. Only the single preview sink accepts a branded value.
 */

declare const sanitizedHtmlBrand: unique symbol;

/** HTML produced by the server sanitizer and validated by this client. */
export type SanitizedHtml = string & {
    readonly [sanitizedHtmlBrand]: "SanitizedHtml";
};

export type RenderMarkdownVariables = Readonly<{ text: string }>;

export type RenderMarkdownData = Readonly<{ html: SanitizedHtml }>;

export type RenderErrorKind =
    | "http"
    | "network"
    | "invalid-json"
    | "invalid-payload";

/** Typed error describing why a render request did not produce valid output. */
export class RenderMarkdownError extends Error {
    readonly kind: RenderErrorKind;
    readonly status: number | null;

    constructor(kind: RenderErrorKind, message: string, status: number | null) {
        super(message);
        this.name = "RenderMarkdownError";
        this.kind = kind;
        this.status = status;
    }
}

export const RENDER_MARKDOWN_PATH = "/api/renderMd";

function fallbackMessage(kind: RenderErrorKind, status: number | null): string {
    switch (kind) {
        case "http":
            return status === null
                ? "Rendering failed. Please try again."
                : `Rendering failed with status ${status}. Please try again.`;
        case "network":
            return "Rendering failed because the request could not be sent. Please try again.";
        case "invalid-json":
            return "Rendering failed because the server response could not be read. Please try again.";
        case "invalid-payload":
            return "Rendering failed because the server response was not valid. Please try again.";
    }
}

/**
 * Extracts a safe, plain-text message from a known error JSON shape
 * (`{ "message": string }`), or returns a status-based fallback. The returned
 * string is always plain text and never contains response HTML.
 */
function safeErrorMessage(
    body: unknown,
    kind: RenderErrorKind,
    status: number | null,
): string {
    if (
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof (body as { message: unknown }).message === "string"
    ) {
        const message = (body as { message: string }).message.trim();
        if (message.length > 0) {
            return message;
        }
    }
    return fallbackMessage(kind, status);
}

/**
 * Validates a fetch {@link Response} and returns branded sanitized HTML, or
 * throws a {@link RenderMarkdownError}. No response-body string from a failed
 * response is ever branded or returned.
 */
export async function decodeRenderMarkdownResponse(
    response: Response,
): Promise<RenderMarkdownData> {
    const status = response.status;
    const raw = await response.text();

    let parsed: unknown;
    let parsedOk = true;
    try {
        parsed = raw.length === 0 ? undefined : JSON.parse(raw);
    } catch {
        parsedOk = false;
        parsed = undefined;
    }

    if (status < 200 || status >= 300) {
        throw new RenderMarkdownError(
            "http",
            safeErrorMessage(parsed, "http", status),
            status,
        );
    }

    if (!parsedOk) {
        throw new RenderMarkdownError(
            "invalid-json",
            fallbackMessage("invalid-json", status),
            status,
        );
    }

    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("html" in parsed) ||
        typeof (parsed as { html: unknown }).html !== "string"
    ) {
        throw new RenderMarkdownError(
            "invalid-payload",
            fallbackMessage("invalid-payload", status),
            status,
        );
    }

    const html = (parsed as { html: string }).html as SanitizedHtml;
    return { html };
}

/**
 * Issues the render request and decodes the response. The body is always
 * `{ "text": variables.text }` with JSON content and accept headers.
 */
export async function renderMarkdown(
    variables: RenderMarkdownVariables,
    signal?: AbortSignal,
): Promise<RenderMarkdownData> {
    let response: Response;
    try {
        response = await fetch(RENDER_MARKDOWN_PATH, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ text: variables.text }),
            signal,
        });
    } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
            throw cause;
        }
        throw new RenderMarkdownError(
            "network",
            fallbackMessage("network", null),
            null,
        );
    }
    return decodeRenderMarkdownResponse(response);
}
