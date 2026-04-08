export { performOpenAIOAuthFlow, ensureFreshOpenAITokens, validateOpenAITokens, getOpenAIAccessToken };

import { type OpenAITokens } from "@/domain/config/config";
import { SUCCESS_HTML, ERROR_HTML } from "@/lib/auth/templates";
import { Future } from "@/libs/future";
import { debugError, debugLog } from "@/libs/debug";
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_AUTH_URL = `${OPENAI_ISSUER}/oauth/authorize`;
const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`;
const SCOPES = "openid profile email offline_access";
const OAUTH_TIMEOUT_MS = 300_000;
const DEFAULT_PORT = 1455;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type CallbackServer = {
  readonly server: Server;
  readonly port: number;
  readonly codePromise: Promise<string>;
};

const generateCodeVerifier = (): string => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

const findAvailablePort = (): Future<Error, number> =>
  Future.create<Error, number>((reject, resolve) => {
    debugLog("openai.auth.port_scan.start", {
      defaultPort: DEFAULT_PORT
    });

    const testServer = createServer();
    testServer.once("error", () => {
      debugLog("openai.auth.port_scan.busy", {
        port: DEFAULT_PORT
      });
      reject(new Error(`Port ${DEFAULT_PORT} is already in use. Close other applications and try again.`));
    });
    testServer.listen(DEFAULT_PORT, () => {
      testServer.close(() => {
        debugLog("openai.auth.port_scan.selected", {
          port: DEFAULT_PORT
        });
        resolve(DEFAULT_PORT);
      });
    });
  });

const startCallbackServer = (port: number, state: string): Future<Error, CallbackServer> =>
  Future.create<Error, CallbackServer>((reject, resolve) => {
    debugLog("openai.auth.callback_server.starting", {
      port,
      hasState: state.length > 0
    });

    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      debugLog("openai.auth.callback_server.request", {
        method: req.method ?? "UNKNOWN",
        pathname: url.pathname
      });

      if (url.pathname !== "/auth/callback") {
        debugLog("openai.auth.callback_server.request.ignored", { pathname: url.pathname });
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        debugLog("openai.auth.callback_server.request.oauth_error", {
          error,
          hasDescription: description.length > 0
        });
        rejectCode(new Error(`OAuth error: ${description}`));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(description));
        return;
      }

      const returnedState = url.searchParams.get("state");
      if (returnedState !== state) {
        const msg = "CSRF state mismatch — possible attack";
        debugLog("openai.auth.callback_server.request.state_mismatch", {
          hasReturnedState: returnedState !== null
        });
        rejectCode(new Error(msg));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(msg));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        debugLog("openai.auth.callback_server.request.no_code");
        rejectCode(new Error("No authorization code received"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML("No authorization code received"));
        return;
      }

      debugLog("openai.auth.callback_server.request.code_received", {
        codeLength: code.length
      });
      resolveCode(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
    });

    server.once("error", (err) => {
      debugError("openai.auth.callback_server.error", err);
      reject(new Error(`Failed to start callback server on port ${port}: ${err}`));
    });
    server.listen(port, () => {
      debugLog("openai.auth.callback_server.started", { port });
      resolve({ server, port, codePromise });
    });
  });

const stopCallbackServer = (cs: CallbackServer): Future<Error, void> =>
  Future.create<Error, void>((_, resolve) => {
    debugLog("openai.auth.callback_server.stopping", { port: cs.port });
    cs.server.close(() => {
      debugLog("openai.auth.callback_server.stopped", { port: cs.port });
      resolve(undefined);
    });
  });

const openBrowser = (url: string): Future<Error, void> =>
  Future.attemptP(async () => {
    debugLog("openai.auth.browser.open.start", {
      urlHost: new URL(url).host
    });
    const open = (await import("open")).default;
    await open(url);
    debugLog("openai.auth.browser.open.success");
  }).chainRej((_) => {
    debugLog("openai.auth.browser.open.fallback_manual");
    console.log("\nCould not open browser automatically.");
    console.log(`Please open the following URL in your browser:\n${url}\n`);
    return Future.resolve(undefined);
  });

const exchangeCodeForTokens = (code: string, codeVerifier: string, redirectUri: string): Future<Error, OpenAITokens> =>
  Future.attemptP(async () => {
    debugLog("openai.auth.token_exchange.request", {
      redirectUri,
      grantType: "authorization_code",
      codeLength: code.length,
      codeVerifierLength: codeVerifier.length
    });

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

    debugLog("openai.auth.token_exchange.http", {
      ok: response.ok,
      status: response.status
    });

    if (!response.ok) {
      const errorBody = await response.text();
      debugLog("openai.auth.token_exchange.error_body", errorBody);
      throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    debugLog("openai.auth.token_exchange.response", {
      hasAccessToken: Boolean(data.access_token),
      hasRefreshToken: Boolean(data.refresh_token),
      expiresInSeconds: data.expires_in
    });

    if (!data.access_token || !data.refresh_token) {
      throw new Error("Incomplete token response from OpenAI. Missing access_token or refresh_token.");
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000
    };
  }).mapRej((e) => {
    debugError("openai.auth.token_exchange.error", e);
    return new Error(`Token exchange failed: ${e}`);
  });

const performOpenAIOAuthFlow = (): Future<Error, OpenAITokens> =>
  findAvailablePort().chain((port) => {
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString("base64url");
    debugLog("openai.auth.flow.start", {
      port,
      redirectUri,
      scopes: SCOPES,
      codeChallengeLength: codeChallenge.length,
      stateLength: state.length
    });

    const authUrl = new URL(OPENAI_AUTH_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", OPENAI_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("id_token_add_organizations", "true");
    authUrl.searchParams.set("codex_cli_simplified_flow", "true");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("originator", "codex_cli_rs");
    debugLog("openai.auth.flow.url_ready", {
      authHost: authUrl.host
    });

    return Future.bracket<Error, CallbackServer, OpenAITokens, void>(
      startCallbackServer(port, state),
      stopCallbackServer,
      (cs) => {
        const waitForCode: Future<Error, string> = openBrowser(authUrl.toString()).chain(() =>
          Future.attemptP(() => cs.codePromise)
        );

        const timeout: Future<Error, string> = Future.create<Error, string>((reject) => {
          const timer = setTimeout(
            () => reject(new Error("OAuth flow timed out after 5 minutes. Please try again.")),
            OAUTH_TIMEOUT_MS
          );
          return () => clearTimeout(timer);
        });

        return Future.race(waitForCode, timeout).chain((code) =>
          exchangeCodeForTokens(code, codeVerifier, redirectUri)
        );
      }
    ).map((tokens) => {
      debugLog("openai.auth.flow.success", {
        hasAccessToken: Boolean(tokens.access_token),
        hasRefreshToken: Boolean(tokens.refresh_token),
        expiryDate: tokens.expiry_date
      });
      return tokens;
    });
  });

const ensureFreshOpenAITokens = (tokens: OpenAITokens): Future<Error, OpenAITokens> => {
  const isExpired = tokens.expiry_date <= Date.now() + TOKEN_REFRESH_BUFFER_MS;
  debugLog("openai.auth.refresh.check", {
    isExpired,
    now: Date.now(),
    expiryDate: tokens.expiry_date,
    refreshBufferMs: TOKEN_REFRESH_BUFFER_MS
  });

  if (!isExpired) {
    return Future.resolve(tokens);
  }

  return Future.attemptP(async () => {
    debugLog("openai.auth.refresh.request", {
      issuer: OPENAI_ISSUER,
      tokenUrl: OPENAI_TOKEN_URL,
      grantType: "refresh_token"
    });

    const response = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: OPENAI_CLIENT_ID,
        refresh_token: tokens.refresh_token
      })
    });

    debugLog("openai.auth.refresh.http", {
      ok: response.ok,
      status: response.status
    });

    if (!response.ok) {
      const errorBody = await response.text();
      debugLog("openai.auth.refresh.error_body", errorBody);
      throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    debugLog("openai.auth.refresh.response", {
      expiresInSeconds: data.expires_in,
      hasAccessToken: Boolean(data.access_token),
      hasRefreshToken: Boolean(data.refresh_token)
    });

    if (!data.access_token) {
      throw new Error("Token refresh returned no access_token");
    }

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000
    };
  }).mapRej((err) => {
    debugError("openai.auth.refresh.error", err);
    const message = String(err);
    if (message.includes("invalid_grant")) {
      return new Error("OpenAI tokens have been revoked. Please run 'commit-tools setup' to re-authenticate.");
    }
    return new Error(`OpenAI token refresh failed: ${message}`);
  });
};

const validateOpenAITokens = (tokens: OpenAITokens): Future<Error, void> =>
  tokens.access_token && tokens.access_token.length > 0 ?
    (() => {
      debugLog("openai.auth.validate.success", {
        accessTokenLength: tokens.access_token.length
      });
      return Future.resolve(undefined);
    })()
  : Future.reject(new Error("No valid OpenAI access token available"));

const getOpenAIAccessToken = (tokens: OpenAITokens): Future<Error, string> =>
  tokens.access_token ?
    (() => {
      const accessToken = tokens.access_token;
      debugLog("openai.auth.access_token.success", {
        accessTokenLength: accessToken.length
      });
      return Future.resolve(accessToken);
    })()
  : Future.reject(new Error("No OpenAI access token provided"));
