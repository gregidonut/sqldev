import { afterEach, describe, expect, mock, test } from "bun:test";
import {
    decodeRenderMarkdownResponse,
    RENDER_MARKDOWN_PATH,
    RenderMarkdownError,
    renderMarkdown,
} from "./renderMarkdownClient.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

describe("renderMarkdown request construction", () => {
    test("POSTs to /api/renderMd with JSON headers and a { text } body", async () => {
        const calls: Array<{ url: string; init: RequestInit }> = [];
        globalThis.fetch = mock(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return jsonResponse({ html: "<p>x</p>" });
        }) as unknown as typeof fetch;

        await renderMarkdown({ text: "# hi\nünïcode\r\n" });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(RENDER_MARKDOWN_PATH);
        expect(calls[0].init.method).toBe("POST");
        const headers = calls[0].init.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");
        expect(headers.Accept).toBe("application/json");
        expect(calls[0].init.body).toBe(
            JSON.stringify({ text: "# hi\nünïcode\r\n" }),
        );
    });

    test("preserves an empty string body", async () => {
        let seenBody: unknown;
        globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
            seenBody = init.body;
            return jsonResponse({ html: "" });
        }) as unknown as typeof fetch;

        const data = await renderMarkdown({ text: "" });
        expect(seenBody).toBe(JSON.stringify({ text: "" }));
        expect(data.html).toBe("" as typeof data.html);
    });
});

describe("decodeRenderMarkdownResponse success", () => {
    test("accepts a 2xx JSON string html", async () => {
        const data = await decodeRenderMarkdownResponse(
            jsonResponse({ html: "<p>ok</p>" }),
        );
        expect(data.html).toBe("<p>ok</p>" as typeof data.html);
    });

    test("accepts an empty html string", async () => {
        const data = await decodeRenderMarkdownResponse(jsonResponse({ html: "" }));
        expect(data.html).toBe("" as typeof data.html);
    });
});

describe("decodeRenderMarkdownResponse errors", () => {
    test("non-2xx becomes an http error carrying the status", async () => {
        const err = (await decodeRenderMarkdownResponse(
            jsonResponse({ message: "boom" }, 500),
        ).catch((e: unknown) => e)) as RenderMarkdownError;
        expect(err).toBeInstanceOf(RenderMarkdownError);
        expect(err.kind).toBe("http");
        expect(err.status).toBe(500);
        expect(err.message).toBe("boom");
    });

    test("non-2xx without a known message uses a status fallback", async () => {
        const err = (await decodeRenderMarkdownResponse(
            new Response("<html>nope</html>", { status: 502 }),
        ).catch((e: unknown) => e)) as RenderMarkdownError;
        expect(err.kind).toBe("http");
        expect(err.status).toBe(502);
        expect(err.message).not.toContain("<html>");
    });

    test("invalid JSON on success is invalid-json", async () => {
        const err = (await decodeRenderMarkdownResponse(
            new Response("not json", {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        ).catch((e: unknown) => e)) as RenderMarkdownError;
        expect(err.kind).toBe("invalid-json");
    });

    test.each([
        ["missing html", {}],
        ["null html", { html: null }],
        ["numeric html", { html: 1 }],
        ["array html", { html: [] }],
        ["object html", { html: {} }],
    ])("%s is invalid-payload", async (_name, body) => {
        const err = (await decodeRenderMarkdownResponse(
            jsonResponse(body),
        ).catch((e: unknown) => e)) as RenderMarkdownError;
        expect(err.kind).toBe("invalid-payload");
    });
});

describe("renderMarkdown network and abort behavior", () => {
    test("a fetch rejection becomes a network error", async () => {
        globalThis.fetch = mock(async () => {
            throw new TypeError("connection refused");
        }) as unknown as typeof fetch;

        const err = (await renderMarkdown({ text: "x" }).catch(
            (e: unknown) => e,
        )) as RenderMarkdownError;
        expect(err).toBeInstanceOf(RenderMarkdownError);
        expect(err.kind).toBe("network");
    });

    test("an abort propagates as an AbortError, not a render error", async () => {
        globalThis.fetch = mock(async () => {
            throw new DOMException("aborted", "AbortError");
        }) as unknown as typeof fetch;

        const err = (await renderMarkdown({ text: "x" }).catch(
            (e: unknown) => e,
        )) as DOMException;
        expect(err).toBeInstanceOf(DOMException);
        expect(err.name).toBe("AbortError");
    });
});
