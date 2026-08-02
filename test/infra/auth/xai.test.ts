import { afterEach, describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";

import { buildXaiAuthUrl, ensureFreshXaiTokens, xaiApiKeyOptions, xaiOAuthOptions } from "@/infra/auth/xai";
import { generateCodeChallenge, generateCodeVerifier } from "@/infra/auth/oauth";
import { runFuture } from "@test/helpers/run-future";

afterEach(() => vi.unstubAllGlobals());

const tokens = (expiry_date: number) => ({ access_token: "old-access", refresh_token: "old-refresh", expiry_date });

describe("xaiApiKeyOptions", () => {
  it("targets the public API and lets the SDK retry", () => {
    expect(xaiApiKeyOptions("xai-test")).toMatchObject({ baseURL: "https://api.x.ai/v1", apiKey: "xai-test", maxRetries: 3 });
  });
});

describe("xaiOAuthOptions", () => {
  it("targets the CLI proxy and flags the bearer as a user token", () => {
    expect(xaiOAuthOptions("access")).toMatchObject({
      baseURL: "https://cli-chat-proxy.grok.com/v1",
      apiKey: "access",
      defaultHeaders: { "X-XAI-Token-Auth": "xai-grok-cli" }
    });
  });

  it("disables SDK retries so a metered subscription is not burned three times over", () => {
    expect(xaiOAuthOptions("access").maxRetries).toBe(0);
  });
});

describe("buildXaiAuthUrl", () => {
  const url = () => new URL(buildXaiAuthUrl("http://127.0.0.1:54321/callback", "challenge", "state-value"));

  it("uses the discovered authorize endpoint", () => {
    expect(url().origin + url().pathname).toBe("https://auth.x.ai/oauth2/authorize");
  });

  it("requests an authorization code with PKCE S256", () => {
    const params = url().searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("code_challenge")).toBe("challenge");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe("state-value");
  });

  it("identifies the client and the loopback redirect", () => {
    const params = url().searchParams;
    expect(params.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(params.get("redirect_uri")).toBe("http://127.0.0.1:54321/callback");
    expect(params.get("referrer")).toBe("grok-build");
  });

  it("requests offline access so a refresh token is issued", () => {
    expect(url().searchParams.get("scope")).toContain("offline_access");
  });
});

describe("PKCE challenge derivation", () => {
  it("is the base64url SHA-256 of the verifier", () => {
    const verifier = generateCodeVerifier();

    expect(generateCodeChallenge(verifier)).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
});

describe("ensureFreshXaiTokens", () => {
  it("returns the existing tokens when they are not near expiry", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const current = tokens(Date.now() + 60 * 60 * 1000);
    const result = await runFuture(ensureFreshXaiTokens(current));

    expect(result).toEqual(current);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes within the expiry buffer and keeps the old refresh token when none is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }))
    );

    const result = await runFuture(ensureFreshXaiTokens(tokens(Date.now() + 60 * 1000)));

    expect(result.access_token).toBe("new-access");
    expect(result.refresh_token).toBe("old-refresh");
    expect(result.expiry_date).toBeGreaterThan(Date.now());
  });

  it("posts a form-encoded refresh_token grant with the client id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runFuture(ensureFreshXaiTokens(tokens(0)));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.x.ai/oauth2/token");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
  });

  it("prefers a rotated refresh token when the server returns one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "new-access", refresh_token: "rotated", expires_in: 3600 }), { status: 200 }))
    );

    const result = await runFuture(ensureFreshXaiTokens(tokens(0)));

    expect(result.refresh_token).toBe("rotated");
  });

  it("tells the user to re-authenticate when the refresh token was revoked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    );

    await expect(runFuture(ensureFreshXaiTokens(tokens(0)))).rejects.toThrow("commit-tools setup");
  });

  it("surfaces other refresh failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream exploded", { status: 500 }))
    );

    await expect(runFuture(ensureFreshXaiTokens(tokens(0)))).rejects.toThrow("xAI token refresh failed");
  });

  it("rejects a refresh response with no access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }))
    );

    await expect(runFuture(ensureFreshXaiTokens(tokens(0)))).rejects.toThrow("no access_token");
  });
});
