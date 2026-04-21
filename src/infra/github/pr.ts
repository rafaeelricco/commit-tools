export { getOpenPullRequest, type PullRequest, type PrLookup };

import * as repo from "@/infra/git/repo";
import * as Decoder from "@/libs/json/decoder";

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { execBin } from "@/infra/shell";

type PullRequest = { url: string; number: number };

type PrLookup = { type: "found"; pr: PullRequest } | { type: "unauthenticated" } | { type: "unavailable" };

const GITHUB_REPO_RE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;
const GH_UNAUTH_RE = /not logged into|gh auth login|authentication required/i;

const parseGithubRepo = (url: string): Maybe<string> => {
  const m = url.match(GITHUB_REPO_RE);
  return m && m[1] ? Just(m[1]) : Nothing();
};

const prDecoder: Decoder.Decoder<PullRequest> = Decoder.object({
  url: Decoder.string,
  number: Decoder.number
});

const parsePrJson = (stdout: string): PrLookup =>
  Decoder.decode(stdout, Decoder.stringified(prDecoder)).either(
    (): PrLookup => ({ type: "unavailable" }),
    (pr): PrLookup => ({ type: "found", pr })
  );

const classifyFailure = (stderr: string): PrLookup =>
  GH_UNAUTH_RE.test(stderr) ? { type: "unauthenticated" } : { type: "unavailable" };

const getOpenPullRequest = (): Future<Error, PrLookup> =>
  Future.both(repo.getTrackingRemoteUrl(), repo.getCurrentBranch())
    .chain(([remoteUrl, branch]) => {
      const slug = parseGithubRepo(remoteUrl);
      return slug instanceof Just ?
          execBin("gh", ["pr", "view", branch, "-R", slug.value, "--json", "url,number"]).map(
            ({ stdout, stderr, exitCode }) => (exitCode !== 0 ? classifyFailure(stderr) : parsePrJson(stdout))
          )
        : Future.resolve<Error, PrLookup>({ type: "unavailable" });
    })
    .chainRej((): Future<Error, PrLookup> => Future.resolve({ type: "unavailable" }));
