import { describe, expect, test } from "bun:test";
import {
  ClerkFapiError,
  exchangeSignInTicket,
  fapiHostFromPublishableKey,
  isLiveClerkKey,
} from "./clerkFapi.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("isLiveClerkKey", () => {
  test.each([
    ["sk_live_abc", true],
    ["pk_live_abc", true],
    ["sk_test_abc", false],
    ["pk_test_abc", false],
    ["", false],
  ])("%s -> %s", (key: string, expected: boolean) => {
    expect(isLiveClerkKey(key)).toBe(expected);
  });
});

describe("fapiHostFromPublishableKey", () => {
  const encode = (host: string) =>
    `pk_live_${Buffer.from(`${host}$`).toString("base64")}`;

  test("decodes the embedded frontend host", () => {
    expect(fapiHostFromPublishableKey(encode("clerk.example.com"))).toBe(
      "clerk.example.com",
    );
  });

  test.each(["pk_live", "pk_live_", "notakey", "pk_live_!!!"])(
    "rejects malformed key %s without echoing it",
    (key: string) => {
      try {
        fapiHostFromPublishableKey(key);
        throw new Error("expected rejection");
      } catch (err) {
        expect(err).toBeInstanceOf(ClerkFapiError);
        expect((err as Error).message).not.toContain(key);
      }
    },
  );
});

describe("exchangeSignInTicket", () => {
  test("returns the created session id for a complete sign-in", async () => {
    const result = await exchangeSignInTicket(
      "clerk.example.com",
      "https://app.example.com",
      "ticket-secret",
      fakeFetch(200, {
        response: { status: "complete", created_session_id: "sess_1" },
      }),
    );
    expect(result.sessionId).toBe("sess_1");
  });

  test("sends strategy=ticket with the app origin", async () => {
    let seenUrl = "";
    let seenOrigin = "";
    let seenBody = "";
    const spy = (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenOrigin = (init.headers as Record<string, string>).origin ?? "";
      seenBody = String(init.body);
      return new Response(
        JSON.stringify({
          response: { status: "complete", created_session_id: "sess_2" },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await exchangeSignInTicket("clerk.example.com", "https://app.example.com", "t", spy);
    expect(seenUrl).toBe("https://clerk.example.com/v1/client/sign_ins");
    expect(seenOrigin).toBe("https://app.example.com");
    expect(seenBody).toContain("strategy=ticket");
  });

  test.each([
    ["non-2xx", 400, { errors: [{ code: "x" }] }],
    ["incomplete status", 200, { response: { status: "needs_first_factor" } }],
    ["missing session id", 200, { response: { status: "complete" } }],
    ["empty session id", 200, { response: { status: "complete", created_session_id: "" } }],
    ["unexpected body", 200, { nope: true }],
  ])("rejects %s without leaking the ticket", async (_l: string, status: number, body: unknown) => {
    try {
      await exchangeSignInTicket(
        "clerk.example.com",
        "https://app.example.com",
        "ticket-secret",
        fakeFetch(status, body),
      );
      throw new Error("expected rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(ClerkFapiError);
      expect((err as Error).message).not.toContain("ticket-secret");
    }
  });
});
