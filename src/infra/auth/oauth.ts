export { type CallbackServer, generateCodeVerifier, generateCodeChallenge, generateState, stopCallbackServer, openBrowser, oauthTimeout };

import { Future } from "@/libs/future";
import { randomBytes, createHash } from "node:crypto";
import { type Server } from "node:http";

type CallbackServer = {
  readonly server: Server;
  readonly port: number;
  readonly codePromise: Promise<string>;
};

const generateCodeVerifier = (): string => randomBytes(32).toString("base64url");

const generateCodeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

const generateState = (): string => randomBytes(32).toString("base64url");

const stopCallbackServer = (cs: CallbackServer): Future<Error, void> =>
  Future.create<Error, void>((_, resolve) => {
    cs.server.close(() => {
      resolve(undefined);
    });
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

/** Races against the browser round-trip so an abandoned sign-in cannot hang the CLI forever. */
const oauthTimeout = (ms: number, message: string): Future<Error, never> =>
  Future.create<Error, never>((reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    return () => clearTimeout(timer);
  });
