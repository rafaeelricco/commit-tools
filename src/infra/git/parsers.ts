export {
  parsePushRange,
  formatCommitOutput,
  oldestReflogSubject,
  parseCreatedFrom,
  normalizeBranchRef,
  parseBaseFromReflog,
  parseRemoteFromUpstream,
  splitCommitFields,
  commandFailureMessage,
  CREATED_FROM_RE,
  COMMIT_KEYS,
  type BaseLookupError
};

import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Result, Success, Failure } from "@/libs/result";
import { type CommandFailure } from "@/infra/shell";

type PushRange = { before: string; after: string };

type BaseLookupError = { type: "reflog-empty" } | { type: "reflog-not-creation"; subject: string } | { type: "reflog-cmd-failed"; message: string };

const CREATED_FROM_RE = /^branch: Created from (\S+)$/;

const COMMIT_KEYS = ["hash", "short", "subject", "authorName", "authorEmail", "date"] as const;

const commandFailureMessage = (failure: CommandFailure, fallbackMsg: string): string =>
  failure.output.stderr.trim() || failure.output.stdout.trim() || `${failure.error.message}: ${fallbackMsg}`;

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

const oldestReflogSubject = (stdout: string): Result<BaseLookupError, string> => {
  const oldest = stdout.split("\n").filter(Boolean).at(-1);
  return oldest ? Success(oldest) : Failure({ type: "reflog-empty" });
};

const parseCreatedFrom = (subject: string): Result<BaseLookupError, string> => {
  const source = subject.match(CREATED_FROM_RE)?.[1];
  return source && source !== "HEAD" ? Success(source) : Failure({ type: "reflog-not-creation", subject });
};

const normalizeBranchRef = (ref: string): string => ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");

const parseBaseFromReflog = (stdout: string): Result<BaseLookupError, string> =>
  oldestReflogSubject(stdout).chain(parseCreatedFrom).map(normalizeBranchRef);

const parseRemoteFromUpstream = (upstream: string): Maybe<string> => {
  const idx = upstream.indexOf("/");
  return idx > 0 ? Just(upstream.slice(0, idx)) : Nothing();
};

const splitCommitFields = (stdout: string): Result<string, Record<string, unknown>> => {
  const parts = stdout.replace(/\n$/, "").split("\x00");
  return parts.length === COMMIT_KEYS.length ?
      Success(Object.fromEntries(COMMIT_KEYS.map((k, i) => [k, parts[i]])))
    : Failure(`expected ${COMMIT_KEYS.length} fields, got ${parts.length}`);
};
