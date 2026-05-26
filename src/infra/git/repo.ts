export {
  checkIsGitRepo,
  getStagedDiff,
  getLocalChangeContext,
  createAndSwitchBranch,
  performCommit,
  performPush,
  getCurrentBranch,
  findCurrentBranch,
  hasUpstream,
  getUpstream,
  getBaseBranch,
  findBaseBranch,
  getCommitMetadata,
  findCommitMetadata,
  getRemoteUrl,
  getTrackingRemoteUrl,
  findTrackingRemoteUrl,
  NO_LOCAL_CHANGES_MESSAGE,
  isNoLocalChangesError,
  type CommitMetadata,
  type PushResult,
  type PushRange
};

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Result, Failure } from "@/libs/result";
import { absurd } from "@/libs/types";
import { type BaseLookupError } from "@/infra/git/parsers";
import { execBin } from "@/infra/shell";
import * as Decoder from "@/libs/json/decoder";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parsePushRange,
  formatCommitOutput,
  parseBaseFromReflog,
  parseRemoteFromUpstream,
  splitCommitFields,
  commandFailureMessage
} from "@/infra/git/parsers";

type CommitMetadata = {
  hash: string;
  short: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  date: Date;
};

type PushRange = { before: string; after: string };

type PushResult = {
  output: string;
  range: Maybe<PushRange>;
};

const execGitChecked = (args: string[], fallbackMsg: string): Future<Error, string> =>
  execBin("git", args).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, string>(new Error(commandFailureMessage(failure, fallbackMsg))),
      ({ stdout }) => Future.resolve<Error, string>(stdout)
    )
  );

const checkIsGitRepo = (): Future<Error, void> => execGitChecked(["rev-parse", "--is-inside-work-tree"], "Not a git repository").map(() => {});

const getStagedDiff = (): Future<Error, string> =>
  execGitChecked(["diff", "--staged"], "Failed to get staged changes").chain((stdout) =>
    stdout.trim() ? Future.resolve<Error, string>(stdout) : Future.reject<Error, string>(new Error("No staged changes found"))
  );

const NO_LOCAL_CHANGES_MESSAGE = "No local changes to infer a branch name from";

const isNoLocalChangesError = (err: unknown): err is Error => err instanceof Error && err.message === NO_LOCAL_CHANGES_MESSAGE;

const getLocalChangeContext = (): Future<Error, string> =>
  execGitChecked(["diff", "HEAD"], "Failed to read local diff").chain((diffStdout) =>
    execGitChecked(["status", "--porcelain", "--untracked-files=all"], "Failed to read git status").chain((statusStdout) =>
      Future.attemptP(async () => {
        const diffPart = diffStdout.trim();
        const statusPart = statusStdout.trim();
        if (diffPart.length === 0 && statusPart.length === 0) {
          throw new Error(NO_LOCAL_CHANGES_MESSAGE);
        }
        return statusPart.length > 0 ? `${diffPart}\n\n--- git status --porcelain ---\n${statusPart}\n` : diffPart;
      })
    )
  );

const createAndSwitchBranch = (name: string): Future<Error, void> =>
  execGitChecked(["switch", "-c", name], `Failed to create branch '${name}'`).map(() => {});

const performCommit = (message: string): Future<Error, string> => {
  const tmpPath = join(tmpdir(), `commit-msg-${Date.now()}.txt`);
  return Future.bracket(
    Future.attemptP(() => writeFile(tmpPath, message, "utf-8")),
    () => Future.attemptP(() => unlink(tmpPath).catch(() => {})),
    () => execBin("git", ["commit", "-F", tmpPath])
  ).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, string>(new Error(commandFailureMessage(failure, "Commit failed"))),
      ({ stdout }) => Future.resolve<Error, string>(formatCommitOutput(stdout))
    )
  );
};

const performPush = (branch?: string, publish = false, forceWithLease = false): Future<Error, PushResult> => {
  const args = publish && branch ? ["push", "--set-upstream", "origin", branch] : ["push"];
  if (forceWithLease) args.push("--force-with-lease");
  return execBin("git", args).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, PushResult>(new Error(commandFailureMessage(failure, "Push failed"))),
      ({ stdout, stderr }) =>
        Future.resolve<Error, PushResult>({
          output: stdout + stderr,
          range: parsePushRange(stdout + "\n" + stderr)
        })
    )
  );
};

const getCurrentBranch = (): Future<Error, string> =>
  execGitChecked(["rev-parse", "--abbrev-ref", "HEAD"], "Failed to get current branch").map((s) => s.trim());

const findCurrentBranch = (): Future<Error, Maybe<string>> =>
  getCurrentBranch()
    .map<Maybe<string>>((branch) => Just<string>(branch))
    .chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const hasUpstream = (): Future<Error, boolean> =>
  execBin("git", ["rev-parse", "--abbrev-ref", "@{u}"]).map((result) =>
    result.either(
      () => false,
      () => true
    )
  );

const getUpstream = (): Future<Error, Maybe<string>> =>
  execBin("git", ["rev-parse", "--abbrev-ref", "@{u}"]).map((result) =>
    result.either(
      () => Nothing<string>(),
      ({ stdout }) => Just(stdout.trim())
    )
  );

const getBaseFromReflog = (branch: string): Future<Error, Result<BaseLookupError, string>> =>
  execBin("git", ["log", "-g", "--format=%gs", branch]).map((result) =>
    result.either(
      (failure) =>
        Failure<BaseLookupError, string>({
          type: "reflog-cmd-failed",
          message: commandFailureMessage(failure, "Failed to read branch reflog")
        }),
      ({ stdout }) => parseBaseFromReflog(stdout)
    )
  );

const getDefaultRemoteBranch = (): Future<Error, Maybe<string>> =>
  execBin("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).map((result) =>
    result.either(
      () => Nothing<string>(),
      ({ stdout }) => Just(stdout.trim().replace(/^origin\//, ""))
    )
  );

const getBaseBranch = (): Future<Error, Maybe<string>> =>
  getCurrentBranch().chain((branch) =>
    getBaseFromReflog(branch).chain((result) =>
      result.either(
        (err) => {
          switch (err.type) {
            case "reflog-empty":
            case "reflog-not-creation":
              return getDefaultRemoteBranch();
            case "reflog-cmd-failed":
              return Future.reject<Error, Maybe<string>>(new Error(`git reflog failed: ${err.message}`));
            default:
              return absurd(err, "BaseLookupError");
          }
        },
        (base) => (base === branch ? getDefaultRemoteBranch() : Future.resolve<Error, Maybe<string>>(Just(base)))
      )
    )
  );

const findBaseBranch = (): Future<Error, Maybe<string>> => getBaseBranch().chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const getRemoteUrl = (remote: string = "origin"): Future<Error, string> =>
  execGitChecked(["remote", "get-url", remote], `Failed to read remote '${remote}' url`).map((s) => s.trim());

const getTrackingRemoteUrl = (): Future<Error, string> =>
  getUpstream().chain((maybeRef) => {
    const remote = maybeRef instanceof Just ? parseRemoteFromUpstream(maybeRef.value) : Nothing<string>();
    return getRemoteUrl(remote instanceof Just ? remote.value : "origin");
  });

const findTrackingRemoteUrl = (): Future<Error, Maybe<string>> =>
  getTrackingRemoteUrl()
    .map<Maybe<string>>((url) => Just<string>(url))
    .chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const nonEmptyString: Decoder.Decoder<string> = Decoder.string.chain((s) =>
  s.length > 0 ? Decoder.always(s) : Decoder.fail("expected non-empty string")
);

const isoDate: Decoder.Decoder<Date> = nonEmptyString.chain((s) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? Decoder.fail(`invalid ISO date: ${s}`) : Decoder.always(d);
});

const commitMetadataDecoder: Decoder.Decoder<CommitMetadata> = Decoder.object({
  hash: nonEmptyString,
  short: nonEmptyString,
  subject: Decoder.string,
  authorName: Decoder.string,
  authorEmail: Decoder.string,
  date: isoDate
});

const COMMIT_FIELDS = [
  ["hash", "%H"],
  ["short", "%h"],
  ["subject", "%s"],
  ["authorName", "%an"],
  ["authorEmail", "%ae"],
  ["date", "%aI"]
] as const;

const COMMIT_FORMAT = COMMIT_FIELDS.map(([, p]) => p).join("%x00");

const getCommitMetadata = (ref: string = "HEAD"): Future<Error, CommitMetadata> =>
  execGitChecked(["log", "-1", `--format=${COMMIT_FORMAT}`, ref], "Failed to read commit metadata").chain((stdout) =>
    splitCommitFields(stdout)
      .chain((obj) => Decoder.decode(obj, commitMetadataDecoder))
      .either(
        (msg) => Future.reject<Error, CommitMetadata>(new Error(`Malformed git log output: ${msg}`)),
        (md) => Future.resolve<Error, CommitMetadata>(md)
      )
  );

const findCommitMetadata = (ref: string = "HEAD"): Future<Error, Maybe<CommitMetadata>> =>
  getCommitMetadata(ref)
    .map<Maybe<CommitMetadata>>((metadata) => Just<CommitMetadata>(metadata))
    .chainRej(() => Future.resolve<Error, Maybe<CommitMetadata>>(Nothing<CommitMetadata>()));
