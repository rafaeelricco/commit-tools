import { afterEach, describe, expect, it, vi } from "vitest";

import { performOpenAIOAuthFlow } from "@/infra/auth/openai";
import { Future } from "@/libs/future";
import { runFuture } from "@test/helpers/run-future";

afterEach(() => vi.unstubAllGlobals());

describe("performOpenAIOAuthFlow", () => {
  const noop = { onDeviceCode: () => Future.resolve<Error, void>(undefined) };
  const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const usercodeBody = { device_auth_id: "auth-1", user_code: "ABCD-1234", interval: "0.001" };
  const pollBody = { authorization_code: "authz", code_verifier: "verifier" };
  const tokenBody = { access_token: "oa-access", refresh_token: "oa-refresh", expires_in: 3600 };

  const stubFlow = (overrides?: { usercode?: Response; poll?: (n: number) => Response }) => {
    let polls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/deviceauth/usercode")) return overrides?.usercode ?? jsonResponse(usercodeBody);
      if (url.endsWith("/deviceauth/token")) {
        polls += 1;
        return overrides?.poll?.(polls) ?? jsonResponse(pollBody);
      }
      if (url.endsWith("/oauth/token")) return jsonResponse(tokenBody);
      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("posts JSON client_id to the Codex usercode endpoint", async () => {
    const fetchMock = stubFlow();

    await runFuture(performOpenAIOAuthFlow(noop));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.openai.com/api/accounts/deviceauth/usercode");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" });
  });

  it("polls with device_auth_id and user_code then exchanges at the device redirect", async () => {
    const fetchMock = stubFlow();

    const result = await runFuture(performOpenAIOAuthFlow(noop));

    expect(result.access_token).toBe("oa-access");
    const pollCall = fetchMock.mock.calls.find((call) => (call[0] as string).endsWith("/deviceauth/token")) as unknown as [string, RequestInit];
    expect(JSON.parse(pollCall[1].body as string)).toEqual({
      device_auth_id: "auth-1",
      user_code: "ABCD-1234"
    });
    const exchange = fetchMock.mock.calls.find((call) => (call[0] as string).endsWith("/oauth/token")) as unknown as [string, RequestInit];
    const body = new URLSearchParams(exchange[1].body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authz");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("redirect_uri")).toBe("https://auth.openai.com/deviceauth/callback");
  });

  it("treats HTTP 403 as pending and retries", async () => {
    const fetchMock = stubFlow({
      poll: (n) => (n === 1 ? new Response("forbidden", { status: 403 }) : jsonResponse(pollBody))
    });

    const result = await runFuture(performOpenAIOAuthFlow(noop));

    expect(result.access_token).toBe("oa-access");
    expect(fetchMock.mock.calls.filter((call) => (call[0] as string).endsWith("/deviceauth/token"))).toHaveLength(2);
  });

  it("treats HTTP 404 on poll as pending and retries", async () => {
    stubFlow({
      poll: (n) => (n === 1 ? new Response("not found", { status: 404 }) : jsonResponse(pollBody))
    });

    const result = await runFuture(performOpenAIOAuthFlow(noop));

    expect(result.refresh_token).toBe("oa-refresh");
  });

  it("tells the user to enable Codex device auth when usercode returns 404", async () => {
    stubFlow({ usercode: new Response("missing", { status: 404 }) });

    await expect(runFuture(performOpenAIOAuthFlow(noop))).rejects.toThrow("Device code login is not enabled");
  });

  it("passes the Codex device URL and user code to onDeviceCode", async () => {
    stubFlow();
    const seen: { userCode: string; verificationUri: string }[] = [];

    await runFuture(
      performOpenAIOAuthFlow({
        onDeviceCode: (prompt) => {
          seen.push(prompt);
          return Future.resolve(undefined);
        }
      })
    );

    expect(seen).toEqual([{ userCode: "ABCD-1234", verificationUri: "https://auth.openai.com/codex/device" }]);
  });
});
