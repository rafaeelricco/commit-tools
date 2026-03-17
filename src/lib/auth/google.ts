export { performOAuthFlow, createAuthenticatedClient, ensureFreshTokens, validateOAuthTokens, getAccessToken };

import { type OAuthTokens } from "@/domain/config/config";
import { SUCCESS_HTML, ERROR_HTML } from "@/lib/auth/templates";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { Future } from "@/libs/future";
import { environment } from "@/app/integrations";
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
  "https://www.googleapis.com/auth/generative-language.tuning",
  "https://www.googleapis.com/auth/userinfo.email"
];
const OAUTH_TIMEOUT_MS = 300_000;
const PORT_RANGE_START = 8400;
const PORT_RANGE_END = 8410;

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
    const tryPort = (port: number): void => {
      if (port > PORT_RANGE_END) {
        reject(
          new Error(
            `No available port found in range ${PORT_RANGE_START}-${PORT_RANGE_END}. Close other applications and try again.`
          )
        );
        return;
      }

      const testServer = createServer();
      testServer.once("error", () => tryPort(port + 1));
      testServer.listen(port, () => {
        testServer.close(() => resolve(port));
      });
    };

    tryPort(PORT_RANGE_START);
  });

const startCallbackServer = (port: number, state: string): Future<Error, CallbackServer> =>
  Future.create<Error, CallbackServer>((reject, resolve) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? error;
        rejectCode(new Error(`OAuth error: ${description}`));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(description));
        return;
      }

      const returnedState = url.searchParams.get("state");
      if (returnedState !== state) {
        const msg = "CSRF state mismatch — possible attack";
        rejectCode(new Error(msg));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML(msg));
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        rejectCode(new Error("No authorization code received"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(ERROR_HTML("No authorization code received"));
        return;
      }

      resolveCode(code);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);
    });

    server.once("error", (err) => reject(new Error(`Failed to start callback server on port ${port}: ${err}`)));
    server.listen(port, () => resolve({ server, port, codePromise }));
  });

const stopCallbackServer = (cs: CallbackServer): Future<Error, void> =>
  Future.create<Error, void>((_, resolve) => {
    cs.server.close(() => resolve(undefined));
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

const exchangeCodeForTokens = (
  client: OAuth2Client,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Future<Error, OAuthTokens> =>
  Future.attemptP(async () => {
    const { tokens } = await client.getToken({
      code,
      codeVerifier,
      redirect_uri: redirectUri
    });

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Incomplete token response from Google. Missing access_token or refresh_token.");
    }

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? SCOPES.join(" ")
    };
  }).mapRej((e) => new Error(`Token exchange failed: ${e}`));

const performOAuthFlow = (): Future<Error, OAuthTokens> =>
  findAvailablePort().chain((port) => {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString("hex");

    const client = new OAuth2Client({
      clientId: environment.GOOGLE_CLIENT_ID,
      clientSecret: environment.GOOGLE_CLIENT_SECRET,
      redirectUri
    });

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      state
    });

    return Future.bracket<Error, CallbackServer, OAuthTokens, void>(
      startCallbackServer(port, state),
      stopCallbackServer,
      (cs) => {
        const waitForCode: Future<Error, string> = openBrowser(authUrl).chain(() =>
          Future.attemptP(() => cs.codePromise)
        );

        const timeout: Future<Error, string> = Future.create<Error, string>((reject) => {
          return () =>
            clearTimeout(
              setTimeout(
                () => reject(new Error("OAuth flow timed out after 5 minutes. Please try again.")),
                OAUTH_TIMEOUT_MS
              )
            );
        });

        return Future.race(waitForCode, timeout).chain((code) =>
          exchangeCodeForTokens(client, code, codeVerifier, redirectUri)
        );
      }
    );
  });

const createAuthenticatedClient = (tokens: OAuthTokens): Future<Error, OAuth2Client> => {
  const client = new OAuth2Client({
    clientId: environment.GOOGLE_CLIENT_ID,
    clientSecret: environment.GOOGLE_CLIENT_SECRET
  });

  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
    scope: tokens.scope
  });

  return Future.resolve(client);
};

const ensureFreshTokens = (tokens: OAuthTokens): Future<Error, OAuthTokens> => {
  const isExpired = tokens.expiry_date <= Date.now() + TOKEN_REFRESH_BUFFER_MS;

  if (!isExpired) {
    return Future.resolve(tokens);
  }

  return createAuthenticatedClient(tokens)
    .chain((client) =>
      Future.attemptP(async () => {
        const { credentials } = await client.refreshAccessToken();

        if (!credentials.access_token) {
          throw new Error("Token refresh returned no access_token");
        }

        return {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token ?? tokens.refresh_token,
          expiry_date: credentials.expiry_date ?? Date.now() + 3600 * 1000,
          token_type: credentials.token_type ?? tokens.token_type,
          scope: credentials.scope ?? tokens.scope
        };
      })
    )
    .mapRej((err) => {
      const message = String(err);
      if (message.includes("invalid_grant")) {
        return new Error(
          "OAuth tokens have been revoked. Please run 'commit-tools setup' or 'commit-tools login' to re-authenticate."
        );
      }
      if (message.includes("invalid_client")) {
        return new Error(
          "OAuth client credentials are invalid. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file."
        );
      }
      return new Error(`Token refresh failed: ${message}`);
    });
};

const validateOAuthTokens = (tokens: OAuthTokens): Future<Error, void> =>
  tokens.access_token && tokens.access_token.length > 0 ?
    Future.resolve(undefined)
  : Future.reject(new Error("No valid access token available"));

const getAccessToken = (tokens: OAuthTokens): Future<Error, string> =>
  tokens.access_token ? Future.resolve(tokens.access_token) : Future.reject(new Error("No access token provided"));
