export {
  xaiApiKeyOptions,
  xaiOAuthOptions,
  performXaiOAuthFlow,
  ensureFreshXaiTokens,
  getXaiAccessToken,
  buildXaiAuthUrl,
  XAI_API_BASE_URL,
  XAI_PROXY_BASE_URL
};

import { type BearerTokens } from "@/domain/config/config";
import { SUCCESS_HTML, ERROR_HTML } from "@/infra/auth/templates";
import {
  type CallbackServer,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  stopCallbackServer,
  openBrowser,
  oauthTimeout
} from "@/infra/auth/oauth";
import { Future } from "@/libs/future";
import { createServer } from "node:http";

import type { ClientOptions } from "openai";

const XAI_API_BASE_URL = "https://api.x.ai/v1";
const XAI_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1";

// Read once from https://auth.x.ai/.well-known/openid-configuration (fetched 2026-08-01).
// Hardcoded on purpose: refresh runs on every command through `resolveProvider`, so live
// discovery would put a network round-trip in front of every commit generation. If xAI
// moves these it will rotate the client id and scopes too, which discovery cannot supply.
const XAI_AUTH_URL = "https://auth.x.ai/oauth2/authorize";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const SCOPES = "openid profile email offline_access grok-cli:access api:access";
const OAUTH_TIMEOUT_MS = 300_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** xAI's API is OpenAI-compatible, so the `openai` client serves it with only a `baseURL` change. */
const xaiApiKeyOptions = (apiKey: string): ClientOptions => ({ baseURL: XAI_API_BASE_URL, apiKey, maxRetries: 3, timeout: 120_000 });

const xaiOAuthOptions = (accessToken: string): ClientOptions => ({
  baseURL: XAI_PROXY_BASE_URL,
  apiKey: accessToken,
  // Tells the proxy the bearer is a user token rather than a deployment key.
  defaultHeaders: { "X-XAI-Token-Auth": "xai-grok-cli" },
  // The proxy meters a subscription, so SDK-level retries would multiply quota burn on a
  // 429. `withTransientRetry` already owns retry policy for every provider.
  maxRetries: 0,
  timeout: 120_000
});

const buildXaiAuthUrl = (redirectUri: string, codeChallenge: string, state: string): string => {
  const url = new URL(XAI_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", XAI_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("referrer", "grok-build");
  return url.toString();
};

/**
 * Binds an OS-assigned loopback port, so the redirect URI is only known once the server is
 * listening — which is why the auth URL is built inside the bracket rather than before it.
 */
const startCallbackServer = (state: string): Future<Error, CallbackServer> =>
  Future.create<Error, CallbackServer>((reject, resolve) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const fail = (message: string): void => {
        rejectCode(new Error(message));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(message));
      };

      const error = url.searchParams.get("error");
      if (error) return fail(`OAuth error: ${url.searchParams.get("error_description") ?? error}`);
      if (url.searchParams.get("state") !== state) return fail("CSRF state mismatch — possible attack");

      const code = url.searchParams.get("code");
      if (!code) return fail("No authorization code received");

      resolveCode(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
    });

    server.once("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err}`));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Callback server did not bind to a TCP port"));
        return;
      }
      resolve({ server, port: address.port, codePromise });
    });
  });

const exchangeCodeForTokens = (code: string, codeVerifier: string, redirectUri: string): Future<Error, BearerTokens> =>
  Future.attemptP(async () => {
    const response = await fetch(XAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: XAI_CLIENT_ID,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier
      }).toString()
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };

    if (!data.access_token || !data.refresh_token) {
      throw new Error("Incomplete token response from xAI. Missing access_token or refresh_token.");
    }

    return { access_token: data.access_token, refresh_token: data.refresh_token, expiry_date: Date.now() + data.expires_in * 1000 };
  }).mapRej((e) => new Error(`Token exchange failed: ${e}`));

const performXaiOAuthFlow = (): Future<Error, BearerTokens> => {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  return Future.bracket<Error, CallbackServer, BearerTokens, void>(startCallbackServer(state), stopCallbackServer, (cs) => {
    const redirectUri = `http://127.0.0.1:${cs.port}/callback`;
    const authUrl = buildXaiAuthUrl(redirectUri, generateCodeChallenge(codeVerifier), state);

    const waitForCode: Future<Error, string> = openBrowser(authUrl).chain(() => Future.attemptP(() => cs.codePromise));
    const timeout = oauthTimeout(OAUTH_TIMEOUT_MS, "OAuth flow timed out after 5 minutes. Please try again.");

    return Future.race<Error, string>(waitForCode, timeout).chain((code) => exchangeCodeForTokens(code, codeVerifier, redirectUri));
  });
};

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
