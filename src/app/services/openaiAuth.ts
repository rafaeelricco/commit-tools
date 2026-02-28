export { performOpenAIOAuthFlow, ensureFreshOpenAITokens, validateOpenAITokens, getOpenAIAccessToken };

import { type OpenAITokens } from "@/app/services/config";
import { SUCCESS_HTML, ERROR_HTML } from "@/app/services/oauthTemplates";
import { Future } from "@/libs/future";
import { randomBytes, createHash } from "crypto";

const OPENAI_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_ISSUER = "https://auth.openai.com";
const OPENAI_AUTH_URL = `${OPENAI_ISSUER}/oauth/authorize`;
const OPENAI_TOKEN_URL = `${OPENAI_ISSUER}/oauth/token`;
const SCOPES = "openid profile email offline_access";
const OAUTH_TIMEOUT_MS = 300_000;
const DEFAULT_PORT = 1455;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type CallbackServer = {
  readonly server: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly codePromise: Promise<string>;
};

const generateCodeVerifier = (): string => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

const findAvailablePort = (): Future<Error, number> =>
  Future.create<Error, number>((reject, resolve) => {
    try {
      const testServer = Bun.serve({
        port: DEFAULT_PORT,
        fetch() {
          return new Response("probe");
        }
      });
      testServer.stop(true);
      resolve(DEFAULT_PORT);
    } catch {
      reject(new Error(`Port ${DEFAULT_PORT} is already in use. Close other applications and try again.`));
    }
  });

const startCallbackServer = (port: number, state: string): Future<Error, CallbackServer> =>
  Future.create<Error, CallbackServer>((reject, resolve) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    try {
      const server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url);

          if (url.pathname !== "/auth/callback") {
            return new Response("Not found", { status: 404 });
          }

          const error = url.searchParams.get("error");
          if (error) {
            const description = url.searchParams.get("error_description") ?? error;
            rejectCode(new Error(`OAuth error: ${description}`));
            return new Response(ERROR_HTML(description), {
              headers: { "Content-Type": "text/html" }
            });
          }

          const returnedState = url.searchParams.get("state");
          if (returnedState !== state) {
            const msg = "CSRF state mismatch — possible attack";
            rejectCode(new Error(msg));
            return new Response(ERROR_HTML(msg), {
              headers: { "Content-Type": "text/html" }
            });
          }

          const code = url.searchParams.get("code");
          if (!code) {
            rejectCode(new Error("No authorization code received"));
            return new Response(ERROR_HTML("No authorization code received"), {
              headers: { "Content-Type": "text/html" }
            });
          }

          resolveCode(code);
          return new Response(SUCCESS_HTML, {
            headers: { "Content-Type": "text/html" }
          });
        }
      });

      resolve({ server, port, codePromise });
    } catch (err) {
      reject(new Error(`Failed to start callback server on port ${port}: ${err}`));
    }
  });

const stopCallbackServer = (cs: CallbackServer): Future<Error, void> =>
  Future.create<Error, void>((_, resolve) => {
    cs.server.stop(true);
    resolve(undefined);
  });

const openBrowser = (url: string): Future<Error, void> =>
  Future.attemptP(async () => {
    const open = (await import("open")).default;
    await open(url);
  }).chainRej((_) => {
    console.log("\nCould not open browser automatically.");
    console.log(`Please open the following URL in your browser:\n${url}\n`);
    return Future.resolve(undefined);
  });

const exchangeCodeForTokens = (code: string, codeVerifier: string, redirectUri: string): Future<Error, OpenAITokens> =>
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

const performOpenAIOAuthFlow = (): Future<Error, OpenAITokens> =>
  findAvailablePort().chain((port) => {
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString("base64url");

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
    );
  });

const ensureFreshOpenAITokens = (tokens: OpenAITokens): Future<Error, OpenAITokens> => {
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

const validateOpenAITokens = (tokens: OpenAITokens): Future<Error, void> =>
  tokens.access_token && tokens.access_token.length > 0 ?
    Future.resolve(undefined)
  : Future.reject(new Error("No valid OpenAI access token available"));

const getOpenAIAccessToken = (tokens: OpenAITokens): Future<Error, string> =>
  tokens.access_token ?
    Future.resolve(tokens.access_token)
  : Future.reject(new Error("No OpenAI access token provided"));
