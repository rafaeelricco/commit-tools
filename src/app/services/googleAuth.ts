export {
  CommitConvention,
  AuthMethod,
  OAuthTokens,
  Config,
  performOAuthFlow,
  createAuthenticatedClient,
  ensureFreshTokens,
  validateOAuthTokens,
  getAccessToken,
};

import * as s from "@/libs/json/schema";


import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { Future } from "@/libs/future";
import { type Dependencies } from "@/app/integrations";
import { randomBytes, createHash } from "crypto";

const CommitConvention = s.stringEnum(["conventional", "imperative", "custom"]);
type CommitConvention = s.Infer<typeof CommitConvention>;

const AuthMethod = s.stringEnum(["api_key", "oauth"]);
type AuthMethod = s.Infer<typeof AuthMethod>;

const OAuthTokens = s.object({
  access_token: s.string,
  refresh_token: s.string,
  expiry_date: s.number,
  token_type: s.string,
  scope: s.string,
});
type OAuthTokens = s.Infer<typeof OAuthTokens>;

const Config = s.object({
  auth_method: s.optionalDefault("api_key" as AuthMethod, AuthMethod),
  api_key: s.optional(s.string),
  tokens: s.optional(OAuthTokens),
  commit_convention: CommitConvention,
  custom_template: s.optional(s.string),
});
type Config = s.Infer<typeof Config>;



const SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "https://www.googleapis.com/auth/userinfo.email",
];
const OAUTH_TIMEOUT_MS = 300_000;
const PORT_RANGE_START = 8400;
const PORT_RANGE_END = 8410;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

type CallbackServer = {
  readonly server: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly codePromise: Promise<string>;
};

const generateCodeVerifier = (): string =>
  randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Authentication Successful</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0f9ff;">
  <div style="text-align:center;padding:2rem;">
    <h1 style="color:#16a34a;">Authentication Successful</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html>
<head><title>Authentication Failed</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef2f2;">
  <div style="text-align:center;padding:2rem;">
    <h1 style="color:#dc2626;">Authentication Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

const findAvailablePort = (): Future<Error, number> =>
  Future.create<Error, number>((reject, resolve) => {
    const tryPort = (port: number): void => {
      if (port > PORT_RANGE_END) {
        reject(new Error(`No available port found in range ${PORT_RANGE_START}-${PORT_RANGE_END}. Close other applications and try again.`));
        return;
      }

      try {
        const testServer = Bun.serve({
          port,
          fetch() {
            return new Response("probe");
          },
        });
        testServer.stop(true);
        resolve(port);
      } catch {
        tryPort(port + 1);
      }
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

    try {
      const server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url);

          if (url.pathname !== "/callback") {
            return new Response("Not found", { status: 404 });
          }

          const error = url.searchParams.get("error");
          if (error) {
            const description = url.searchParams.get("error_description") ?? error;
            rejectCode(new Error(`OAuth error: ${description}`));
            return new Response(ERROR_HTML(description), {
              headers: { "Content-Type": "text/html" },
            });
          }

          const returnedState = url.searchParams.get("state");
          if (returnedState !== state) {
            const msg = "CSRF state mismatch — possible attack";
            rejectCode(new Error(msg));
            return new Response(ERROR_HTML(msg), {
              headers: { "Content-Type": "text/html" },
            });
          }

          const code = url.searchParams.get("code");
          if (!code) {
            rejectCode(new Error("No authorization code received"));
            return new Response(ERROR_HTML("No authorization code received"), {
              headers: { "Content-Type": "text/html" },
            });
          }

          resolveCode(code);
          return new Response(SUCCESS_HTML, {
            headers: { "Content-Type": "text/html" },
          });
        },
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

const openBrowser = async (url: string): Promise<void> => {
  try {
    const open = (await import("open")).default;
    await open(url);
  } catch {
    console.log("\nCould not open browser automatically.");
    console.log(`Please open the following URL in your browser:\n${url}\n`);
  }
};

const exchangeCodeForTokens = (
  client: OAuth2Client,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Future<Error, OAuthTokens> =>
  Future.attemptP(async () => {
    const { tokens } = await client.getToken({
      code,
      codeVerifier,
      redirect_uri: redirectUri,
    });

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Incomplete token response from Google. Missing access_token or refresh_token.");
    }

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600 * 1000,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope ?? SCOPES.join(" "),
    };
  }).mapRej(e => new Error(`Token exchange failed: ${e}`));

const performOAuthFlow = (deps: Dependencies): Future<Error, OAuthTokens> =>
  deps.resolveOAuth().chain(oauth =>
    findAvailablePort().chain(port => {
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = randomBytes(32).toString("hex");

      const client = new OAuth2Client({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        redirectUri,
      });

      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        state,
      });

    return Future.bracket<Error, CallbackServer, OAuthTokens, void>(
      startCallbackServer(port, state),
      stopCallbackServer,
      (cs) => {
        const waitForCode: Future<Error, string> = Future.attemptP(async () => {
          await openBrowser(authUrl);
          return cs.codePromise;
        });

        const timeout: Future<Error, string> = Future.create<Error, string>((reject) => {
          return () => clearTimeout(setTimeout(
            () => reject(new Error("OAuth flow timed out after 5 minutes. Please try again.")),
            OAUTH_TIMEOUT_MS,
          ));
        });

        return Future.race(waitForCode, timeout)
          .chain(code => exchangeCodeForTokens(client, code, codeVerifier, redirectUri));
      },
    );
  })
);

const createAuthenticatedClient = (deps: Dependencies, tokens: OAuthTokens): Future<Error, OAuth2Client> =>
  deps.resolveOAuth().map(oauth => {
    const client = new OAuth2Client({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
    });

    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
      scope: tokens.scope,
    });

    return client;
  });

const ensureFreshTokens = (deps: Dependencies, tokens: OAuthTokens): Future<Error, OAuthTokens> => {
  const isExpired = tokens.expiry_date <= Date.now() + TOKEN_REFRESH_BUFFER_MS;

  if (!isExpired) {
    return Future.resolve(tokens);
  }

  return createAuthenticatedClient(deps, tokens).chain(client =>
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
        scope: credentials.scope ?? tokens.scope,
      };
    })
  ).mapRej(err => {
    const message = String(err);
    if (message.includes("invalid_grant")) {
      return new Error("OAuth tokens have been revoked. Please run 'commit-tools setup' or 'commit-tools login' to re-authenticate.");
    }
    if (message.includes("invalid_client")) {
      return new Error("OAuth client credentials are invalid. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.");
    }
    return new Error(`Token refresh failed: ${message}`);
  });
};

const validateOAuthTokens = (tokens: OAuthTokens): Future<Error, void> =>
  tokens.access_token && tokens.access_token.length > 0
    ? Future.resolve(undefined)
    : Future.reject(new Error("No valid access token available"));

const getAccessToken = (tokens: OAuthTokens): Future<Error, string> =>
  tokens.access_token
    ? Future.resolve(tokens.access_token)
    : Future.reject(new Error("No access token provided"));
