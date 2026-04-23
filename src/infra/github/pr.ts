export { getOpenPullRequest, type PullRequest, type PrLookup };

import * as repo from "@/infra/git/repo";
import * as Decoder from "@/libs/json/decoder";

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { execBin, type CommandFailure } from "@/infra/shell";

type PullRequest = { url: string; number: number };

type PrLookup =
  | { type: "found"; pr: PullRequest }
  | { type: "not-found" }
  | { type: "unauthenticated" }
  | { type: "unavailable" };

// TODO: This looks like a "magical number", we need to think more about this
const GITHUB_REPO_RE = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;
const GH_UNAUTH_RE = /not logged into|gh auth login|authentication required/i;
const GH_NOT_FOUND_RE = /no pull requests? found/i;

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

const commandFailureText = (failure: CommandFailure): string =>
  failure.output.stderr.trim() || failure.output.stdout.trim() || failure.error.message;

const classifyFailure = (failure: CommandFailure): PrLookup => {
  return GH_UNAUTH_RE.test(commandFailureText(failure)) 
  ? { type: "unauthenticated" }
  : GH_NOT_FOUND_RE.test(commandFailureText(failure)) 
  ? { type: "not-found" }
  : { type: "unavailable" };
};

const getOpenPullRequest = (): Future<Error, PrLookup> =>
  Future.both(repo.getTrackingRemoteUrl(), repo.getCurrentBranch())
    .chain(([remoteUrl, branch]) => {
      const slug = parseGithubRepo(remoteUrl);
      return slug instanceof Just ?
          execBin("gh", ["pr", "view", branch, "-R", slug.value, "--json", "url,number"]).map((result) =>
            result.either(classifyFailure, ({ stdout }) => parsePrJson(stdout))
          )
        : Future.resolve<Error, PrLookup>({ type: "unavailable" });
    })
    .chainRej((): Future<Error, PrLookup> => Future.resolve({ type: "unavailable" }));
