export { getOpenPullRequest, type PullRequest, type PrLookup };

import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { execBin } from "@/infra/shell";

type PullRequest = { url: string; number: number };

type PrLookup = { type: "found"; pr: PullRequest } | { type: "unauthenticated" } | { type: "unavailable" };

const GITHUB_HOST_RE = /github\.com[:/]/;
const GH_UNAUTH_RE = /not logged into|gh auth login|authentication required/i;

const parsePrJson = (stdout: string): PrLookup => {
  try {
    const parsed = JSON.parse(stdout) as { url?: unknown; number?: unknown };
    return typeof parsed.url === "string" && typeof parsed.number === "number" ?
        { type: "found", pr: { url: parsed.url, number: parsed.number } }
      : { type: "unavailable" };
  } catch {
    return { type: "unavailable" };
  }
};

const classifyFailure = (stderr: string): PrLookup =>
  GH_UNAUTH_RE.test(stderr) ? { type: "unauthenticated" } : { type: "unavailable" };

const getOpenPullRequest = (): Future<Error, PrLookup> =>
  repo
    .getRemoteUrl()
    .chain((remoteUrl) =>
      !GITHUB_HOST_RE.test(remoteUrl) ?
        Future.resolve<Error, PrLookup>({ type: "unavailable" })
      : execBin("gh", ["pr", "view", "--json", "url,number"]).map(({ stdout, stderr, exitCode }) =>
          exitCode !== 0 ? classifyFailure(stderr) : parsePrJson(stdout)
        )
    )
    .chainRej((): Future<Error, PrLookup> => Future.resolve({ type: "unavailable" }));
