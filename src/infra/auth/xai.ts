export { xaiApiKeyOptions, xaiOAuthOptions, performXaiOAuthFlow, ensureFreshXaiTokens, getXaiAccessToken, XAI_API_BASE_URL, XAI_PROXY_BASE_URL };

export type { DeviceCodePrompt, XaiOAuthFlowHooks };

import { type BearerTokens } from "@/domain/config/config";
import { Future } from "@/libs/future";

import type { ClientOptions } from "openai";

const XAI_API_BASE_URL = "https://api.x.ai/v1";
const XAI_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

// Read once from https://auth.x.ai/.well-known/openid-configuration (fetched 2026-08-01).
// Hardcoded on purpose: refresh runs on every command through `resolveProvider`, so live
// discovery would put a network round-trip in front of every commit generation. If xAI
// moves these it will rotate the client id and scopes too, which discovery cannot supply.
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPES = "openid profile email offline_access grok-cli:access api:access";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// `/chat/completions` on the proxy rejects requests with no client version (HTTP 426) and
// enforces a server-side minimum, so this must be bumped whenever xAI raises it. Taken from
// `crates/codegen/xai-grok-pager/Cargo.toml` in xai-org/grok-build (read 2026-08-01).
// `/models` does not enforce it, so a stale value fails only at generation time.
const XAI_CLIENT_VERSION = "0.2.117";

/** xAI's API is OpenAI-compatible, so the `openai` client serves it with only a `baseURL` change. */
const xaiApiKeyOptions = (apiKey: string): ClientOptions => ({ baseURL: XAI_API_BASE_URL, apiKey, maxRetries: 3, timeout: 120_000 });

const xaiOAuthOptions = (accessToken: string): ClientOptions => ({
  baseURL: XAI_PROXY_BASE_URL,
  apiKey: accessToken,
  // `X-XAI-Token-Auth` tells the proxy the bearer is a user token rather than a deployment
  // key; `x-grok-client-version` clears its minimum-version gate.
  defaultHeaders: { "X-XAI-Token-Auth": "xai-grok-cli", "x-grok-client-version": XAI_CLIENT_VERSION },
  // The proxy meters a subscription, so SDK-level retries would multiply quota burn on a
  // 429. `withTransientRetry` already owns retry policy for every provider.
  maxRetries: 0,
  timeout: 120_000
});

type DeviceCodePrompt = {
  readonly userCode: string;
  readonly verificationUri: string;
};

type XaiOAuthFlowHooks = {
  readonly onDeviceCode: (prompt: DeviceCodePrompt) => Future<Error, void>;
};

type XaiDeviceCode = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalSeconds: number;
  readonly expiresInSeconds: number;
};

type DevicePoll =
  | { readonly status: "complete"; readonly tokens: BearerTokens }
  | { readonly status: "pending"; readonly intervalMs: number }
  | { readonly status: "failed"; readonly message: string };

type JsonObject = Record<string, unknown>;

const requiredString = (body: JsonObject, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
};

const asJsonObject = (value: unknown): JsonObject => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {});

const httpsUri = (raw: string): string => {
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("Untrusted verification URI in xAI OAuth response");
  }
  return url.href;
};

const requestXaiDeviceCode = (): Future<Error, XaiDeviceCode> =>
  Future.attemptP(async () => {
    const response = await fetch(XAI_DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: XAI_CLIENT_ID, scope: SCOPES, referrer: "grok-build" }).toString()
    });

    const body = asJsonObject(await response.json());
    if (!response.ok) {
      const detail = [body["error"], body["error_description"]].filter((value) => typeof value === "string").join(": ");
      throw new Error(`xAI device authorization failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }

    const interval = body["interval"];
    const expiresIn = body["expires_in"];
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error("Invalid xAI OAuth response field: expires_in");
    }

    return {
      deviceCode: requiredString(body, "device_code"),
      userCode: requiredString(body, "user_code"),
      verificationUri: httpsUri(requiredString(body, "verification_uri")),
      intervalSeconds: typeof interval === "number" && Number.isFinite(interval) && interval > 0 ? interval : 5,
      expiresInSeconds: expiresIn
    };
  });

const devicePollFromError = (error: unknown, intervalMs: number, status: number, body: JsonObject): DevicePoll => {
  if (error === "authorization_pending") {
    return { status: "pending", intervalMs };
  }
  if (error === "slow_down") {
    const next = body["interval"];
    return {
      status: "pending",
      intervalMs: typeof next === "number" && next > 0 ? next * 1000 : intervalMs + 5000
    };
  }
  if (error === "access_denied" || error === "authorization_denied") {
    return { status: "failed", message: "xAI device authorization was denied" };
  }
  if (error === "expired_token") {
    return { status: "failed", message: "xAI device code expired" };
  }

  const detail = [error, body["error_description"]].filter((value) => typeof value === "string").join(": ");
  return {
    status: "failed",
    message: `xAI device token polling failed (${status})${detail ? `: ${detail}` : ""}`
  };
};

const pollOnce = (device: XaiDeviceCode, intervalMs: number): Future<Error, DevicePoll> =>
  Future.attemptP(async () => {
    const response = await fetch(XAI_TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_CLIENT_ID,
        device_code: device.deviceCode
      }).toString()
    });

    const body = asJsonObject(await response.json());

    if (!response.ok) {
      return devicePollFromError(body["error"], intervalMs, response.status, body);
    }

    const expiresIn = body["expires_in"];
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
      throw new Error("Incomplete token response from xAI. Missing expires_in.");
    }
    return {
      status: "complete",
      tokens: {
        access_token: requiredString(body, "access_token"),
        refresh_token: requiredString(body, "refresh_token"),
        expiry_date: Date.now() + expiresIn * 1000
      }
    };
  });

const pollXaiDeviceToken = (device: XaiDeviceCode): Future<Error, BearerTokens> => {
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  const interval = { ms: device.intervalSeconds * 1000 };

  const poll = (): Future<Error, BearerTokens> =>
    Future.resolveAfter<Error, void>(interval.ms, undefined).chain(() =>
      pollOnce(device, interval.ms).chain((result) => {
        switch (result.status) {
          case "complete":
            return Future.resolve(result.tokens);
          case "failed":
            return Future.reject(new Error(result.message));
          case "pending": {
            if (Date.now() > deadline) {
              return Future.reject(new Error("xAI device code expired"));
            }
            interval.ms = result.intervalMs;
            return poll();
          }
        }
      })
    );

  return poll();
};

const performXaiOAuthFlow = (hooks: XaiOAuthFlowHooks): Future<Error, BearerTokens> =>
  requestXaiDeviceCode().chain((device) =>
    hooks.onDeviceCode({ userCode: device.userCode, verificationUri: device.verificationUri }).chain(() => pollXaiDeviceToken(device))
  );

const ensureFreshXaiTokens = (tokens: BearerTokens): Future<Error, BearerTokens> => {
  if (tokens.expiry_date > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return Future.resolve(tokens);
  }

  return Future.attemptP(async () => {
    const response = await fetch(XAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: XAI_CLIENT_ID,
        refresh_token: tokens.refresh_token
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };

    if (!data.access_token) {
      throw new Error("Token refresh returned no access_token");
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000
    };
  }).mapRej((err) => {
    const message = String(err);
    if (message.includes("invalid_grant")) {
      return new Error("xAI tokens have been revoked. Please run 'commit-tools setup' to re-authenticate.");
    }
    return new Error(`xAI token refresh failed: ${message}`);
  });
};

const getXaiAccessToken = (tokens: BearerTokens): Future<Error, string> =>
  tokens.access_token ? Future.resolve(tokens.access_token) : Future.reject(new Error("No xAI access token provided"));
