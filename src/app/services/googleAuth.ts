export {
  performOAuthFlow,
  createAuthenticatedClient,
  ensureFreshTokens,
  validateOAuthTokens,
  getAccessToken,
  COMMIT_CONVENTIONS,
  type CommitConvention,
  type OAuthTokens,
  Config,
  type AuthMethod
};

import { COMMIT_CONVENTIONS, type CommitConvention, type OAuthTokens, Config, type AuthMethod } from "./config";

import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { Future } from "@/libs/future";
import { type Dependencies } from "@/app/integrations";
import { randomBytes, createHash } from "crypto";

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
  readonly server: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly codePromise: Promise<string>;
};

const generateCodeVerifier = (): string => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

const COMMON_STYLE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --border: 240 5.9% 90%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --success: 142.1 76.2% 36.3%;
    --destructive: 0 84.2% 60.2%;
    --radius: 0.75rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 3.9%;
      --card-foreground: 0 0% 98%;
      --border: 240 3.7% 15.9%;
      --muted: 240 3.7% 15.9%;
      --muted-foreground: 240 5% 64.9%;
      --success: 142.1 70% 45%;
      --destructive: 0 62.8% 30.6%;
    }
  }
  body {
    font-family: 'Inter', system-ui, sans-serif;
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  .card {
    background-color: hsl(var(--card));
    color: hsl(var(--card-foreground));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    padding: 2.5rem 2rem;
    max-width: 28rem;
    width: 100%;
    text-align: center;
    box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    animation: fade-in-up 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(16px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .icon { width: 48px; height: 48px; margin: 0 auto 1.5rem; stroke-width: 1.5; }
  .icon-success { color: hsl(var(--success)); }
  .icon-error { color: hsl(var(--destructive)); }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; letter-spacing: -0.025em; }
  p { font-size: 0.875rem; color: hsl(var(--muted-foreground)); margin: 0; line-height: 1.5; }
</style>
`;

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Successful</title>
  ${COMMON_STYLE}
</head>
<body>
  <div class="card">
    <svg class="icon icon-success" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <h1>Authentication Successful</h1>
    <p>You have successfully connected your Google account. You can now close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (message: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Failed</title>
  ${COMMON_STYLE}
</head>
<body>
  <div class="card">
    <svg class="icon icon-error" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
    <h1>Authentication Failed</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

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

      try {
        const testServer = Bun.serve({
          port,
          fetch() {
            return new Response("probe");
          }
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

const performOAuthFlow = (deps: Dependencies): Future<Error, OAuthTokens> =>
  deps.resolveOAuth().chain((oauth) =>
    findAvailablePort().chain((port) => {
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = randomBytes(32).toString("hex");

      const client = new OAuth2Client({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
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
    })
  );

const createAuthenticatedClient = (deps: Dependencies, tokens: OAuthTokens): Future<Error, OAuth2Client> =>
  deps.resolveOAuth().map((oauth) => {
    const client = new OAuth2Client({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret
    });

    client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type,
      scope: tokens.scope
    });

    return client;
  });

const ensureFreshTokens = (deps: Dependencies, tokens: OAuthTokens): Future<Error, OAuthTokens> => {
  const isExpired = tokens.expiry_date <= Date.now() + TOKEN_REFRESH_BUFFER_MS;

  if (!isExpired) {
    return Future.resolve(tokens);
  }

  return createAuthenticatedClient(deps, tokens)
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
