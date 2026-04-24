export {
  checkIsGitRepo,
  getStagedDiff,
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
  type CommitMetadata,
  type PushResult,
  type PushRange
};

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Result, Success, Failure } from "@/libs/result";
import { absurd } from "@/libs/types";
import { execBin, type CommandFailure } from "@/infra/shell";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

type BaseLookupError = { type: "reflog-empty" } | { type: "reflog-not-creation"; subject: string } | { type: "reflog-cmd-failed"; message: string };

const CREATED_FROM_RE = /^branch: Created from (\S+)$/;

const commandFailureMessage = (failure: CommandFailure, fallbackMsg: string): string =>
  failure.output.stderr.trim() || failure.output.stdout.trim() || `${failure.error.message}: ${fallbackMsg}`;

const execGitChecked = (args: string[], fallbackMsg: string): Future<Error, string> =>
  execBin("git", args).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, string>(new Error(commandFailureMessage(failure, fallbackMsg))),
      ({ stdout }) => Future.resolve<Error, string>(stdout)
    )
  );

const formatCommitOutput = (stdout: string): string =>
  "\n" +
  stdout
    .split("\n")
    .filter((line) => !line.startsWith("["))
    .join("\n")
    .trim() +
  "\n";

const parsePushRange = (output: string): Maybe<PushRange> => {
  const m = output.match(/([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})/);
  if (!m) return Nothing();
  const [, before, after] = m;
  return before && after ? Just({ before, after }) : Nothing();
};

const checkIsGitRepo = (): Future<Error, void> => execGitChecked(["rev-parse", "--is-inside-work-tree"], "Not a git repository").map(() => {});

const getStagedDiff = (): Future<Error, string> =>
  execGitChecked(["diff", "--staged"], "Failed to get staged changes").chain((stdout) =>
    stdout.trim() ? Future.resolve<Error, string>(stdout) : Future.reject<Error, string>(new Error("No staged changes found"))
  );

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

const oldestReflogSubject = (stdout: string): Result<BaseLookupError, string> => {
  const oldest = stdout.split("\n").filter(Boolean).at(-1);
  return oldest ? Success(oldest) : Failure({ type: "reflog-empty" });
};

const parseCreatedFrom = (subject: string): Result<BaseLookupError, string> => {
  const source = subject.match(CREATED_FROM_RE)?.[1];
  return source && source !== "HEAD" ? Success(source) : Failure({ type: "reflog-not-creation", subject });
};

const normalizeBranchRef = (ref: string): string => ref.replace(/^refs\/heads\//, "");

const parseBaseFromReflog = (stdout: string): Result<BaseLookupError, string> =>
  oldestReflogSubject(stdout).chain(parseCreatedFrom).map(normalizeBranchRef);

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
        (base) => Future.resolve<Error, Maybe<string>>(Just(base))
      )
    )
  );

const findBaseBranch = (): Future<Error, Maybe<string>> => getBaseBranch().chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const getRemoteUrl = (remote: string = "origin"): Future<Error, string> =>
  execGitChecked(["remote", "get-url", remote], `Failed to read remote '${remote}' url`).map((s) => s.trim());

const parseRemoteFromUpstream = (upstream: string): Maybe<string> => {
  const idx = upstream.indexOf("/");
  return idx > 0 ? Just(upstream.slice(0, idx)) : Nothing();
};

const getTrackingRemoteUrl = (): Future<Error, string> =>
  getUpstream().chain((maybeRef) => {
    const remote = maybeRef instanceof Just ? parseRemoteFromUpstream(maybeRef.value) : Nothing<string>();
    return getRemoteUrl(remote instanceof Just ? remote.value : "origin");
  });

const findTrackingRemoteUrl = (): Future<Error, Maybe<string>> =>
  getTrackingRemoteUrl()
    .map<Maybe<string>>((url) => Just<string>(url))
    .chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const getCommitMetadata = (ref: string = "HEAD"): Future<Error, CommitMetadata> =>
  execGitChecked(["log", "-1", `--format=%H%n%h%n%s%n%an%n%ae%n%aI`, ref], "Failed to read commit metadata").chain((stdout) => {
    const [hash, short, subject, authorName, authorEmail, iso] = stdout.split("\n");
    // TODO: This is specially hard to understand and maintain, consider using a more robust serialization format in the future (e.g. JSON output from git log with a custom format)
    return hash && short && subject !== undefined && authorName !== undefined && authorEmail !== undefined && iso ?
        Future.resolve<Error, CommitMetadata>({ hash, short, subject, authorName, authorEmail, date: new Date(iso) })
      : Future.reject<Error, CommitMetadata>(new Error("Malformed git log output"));
  });

const findCommitMetadata = (ref: string = "HEAD"): Future<Error, Maybe<CommitMetadata>> =>
  getCommitMetadata(ref)
    .map<Maybe<CommitMetadata>>((metadata) => Just<CommitMetadata>(metadata))
    .chainRej(() => Future.resolve<Error, Maybe<CommitMetadata>>(Nothing<CommitMetadata>()));
