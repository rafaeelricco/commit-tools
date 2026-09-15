export { performOpenAIOAuthFlow, ensureFreshOpenAITokens, validateOpenAITokens, getOpenAIAccessToken };

export type { OpenAIOAuthFlowHooks };

import { type BearerTokens } from "@/domain/config/config";
import { Future } from "@/libs/future";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`;
const OPENAI_DEVICE_VERIFY_URL = `${OPENAI_ISSUER}/codex/device`;
const OPENAI_DEVICE_USERCODE_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/usercode`;
const OPENAI_DEVICE_POLL_URL = `${OPENAI_ISSUER}/api/accounts/deviceauth/token`;
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_ISSUER}/deviceauth/callback`;
const DEVICE_AUTH_TIMEOUT_MS = 15 * 60 * 1000;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type OpenAIOAuthFlowHooks = {
  readonly onDeviceCode: (prompt: { userCode: string; verificationUri: string }) => Future<Error, void>;
};

type OpenAIDeviceCode = {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly intervalSeconds: number;
};

type OpenAIAuthorization = {
  readonly authorization_code: string;
  readonly code_verifier: string;
};

type DevicePoll =
  | { readonly status: "complete"; readonly code: OpenAIAuthorization }
  | { readonly status: "pending" }
  | { readonly status: "failed"; readonly message: string };

const parseInterval = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 5;
};

const requestOpenAIDeviceCode = (): Future<Error, OpenAIDeviceCode> =>
  Future.attemptP(async () => {
    const response = await fetch(OPENAI_DEVICE_USERCODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: OPENAI_CLIENT_ID })
    });

    if (response.status === 404) {
      throw new Error(
        "Device code login is not enabled. Turn on device code authorization for Codex in ChatGPT → Settings → Security, or use an API key."
      );
    }

    if (!response.ok) {
      throw new Error(`OpenAI device code request failed (${response.status})`);
    }

    const body = (await response.json()) as {
      device_auth_id: string;
      user_code?: string;
      usercode?: string;
      interval?: string | number;
    };
    const userCode = body.user_code ?? body.usercode;
    if (!body.device_auth_id || !userCode) {
      throw new Error("Incomplete OpenAI device code response");
    }

    return { deviceAuthId: body.device_auth_id, userCode, intervalSeconds: parseInterval(body.interval) };
  });

const pollOnce = (device: OpenAIDeviceCode): Future<Error, DevicePoll> =>
  Future.attemptP(async () => {
    const response = await fetch(OPENAI_DEVICE_POLL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: device.deviceAuthId, user_code: device.userCode })
    });

    if (response.ok) {
      const body = (await response.json()) as { authorization_code: string; code_verifier: string };
      if (!body.authorization_code || !body.code_verifier) {
        throw new Error("Incomplete OpenAI device token response");
      }
      return { status: "complete", code: { authorization_code: body.authorization_code, code_verifier: body.code_verifier } };
    }

    if (response.status === 403 || response.status === 404) {
      return { status: "pending" };
    }

    return { status: "failed", message: `OpenAI device auth failed (${response.status})` };
  });

const pollOpenAIDeviceCode = (device: OpenAIDeviceCode): Future<Error, OpenAIAuthorization> => {
  const deadline = Date.now() + DEVICE_AUTH_TIMEOUT_MS;
  const intervalMs = device.intervalSeconds * 1000;

  const poll = (): Future<Error, OpenAIAuthorization> =>
    pollOnce(device).chain((result) => {
      switch (result.status) {
        case "complete":
          return Future.resolve(result.code);
        case "failed":
          return Future.reject(new Error(result.message));
        case "pending": {
          if (Date.now() >= deadline) {
            return Future.reject(new Error("OpenAI device auth timed out after 15 minutes"));
          }
          return Future.resolveAfter<Error, void>(intervalMs, undefined).chain(poll);
        }
      }
    });

  return poll();
};

const exchangeCodeForTokens = (code: string, codeVerifier: string, redirectUri: string): Future<Error, BearerTokens> =>
  Future.attemptP(async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    if (!data.access_token || !data.refresh_token) {
      throw new Error("Incomplete token response from OpenAI. Missing access_token or refresh_token.");
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000
    };
  }).mapRej((e) => new Error(`Token exchange failed: ${e}`));

const performOpenAIOAuthFlow = (hooks: OpenAIOAuthFlowHooks): Future<Error, BearerTokens> =>
  requestOpenAIDeviceCode().chain((device) =>
    hooks
      .onDeviceCode({ userCode: device.userCode, verificationUri: OPENAI_DEVICE_VERIFY_URL })
      .chain(() => pollOpenAIDeviceCode(device))
      .chain((code) => exchangeCodeForTokens(code.authorization_code, code.code_verifier, OPENAI_DEVICE_REDIRECT_URI))
  );

const ensureFreshOpenAITokens = (tokens: BearerTokens): Future<Error, BearerTokens> => {
  const isExpired = tokens.expiry_date <= Date.now() + TOKEN_REFRESH_BUFFER_MS;

  if (!isExpired) {
    return Future.resolve(tokens);
  }

  return Future.attemptP(async () => {
    const response = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: OPENAI_CLIENT_ID,
        refresh_token: tokens.refresh_token
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

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
      return new Error("OpenAI tokens have been revoked. Please run 'commit-tools setup' to re-authenticate.");
    }
    return new Error(`OpenAI token refresh failed: ${message}`);
  });
};

const validateOpenAITokens = (tokens: BearerTokens): Future<Error, void> =>
  tokens.access_token && tokens.access_token.length > 0 ? Future.resolve(undefined) : Future.reject(new Error("No valid OpenAI access token available"));

const getOpenAIAccessToken = (tokens: BearerTokens): Future<Error, string> =>
  tokens.access_token ? Future.resolve(tokens.access_token) : Future.reject(new Error("No OpenAI access token provided"));
