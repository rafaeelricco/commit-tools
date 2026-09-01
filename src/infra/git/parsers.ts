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
  parseHookInterpreter,
  isGeneratedPath,
  parseNumstatCounts,
  formatOmittedPaths,
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

const lastPathSegment = (path: string): string => path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;

const GENERATED_PATH_RE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|(^|\/)(dist|out|__snapshots__)\/|\.min\.(js|css)$|\.snap$/;

const isGeneratedPath = (path: string): boolean => GENERATED_PATH_RE.test(path);

type DiffCounts = { added: string; deleted: string };

const parseNumstatCounts = (stdout: string): ReadonlyMap<string, DiffCounts> => {
  const map = new Map<string, DiffCounts>();
  for (const rec of stdout.split("\0")) {
    const [added, deleted, path] = rec.split("\t");
    if (added !== undefined && deleted !== undefined && path) {
      map.set(path, { added, deleted });
    }
  }
  return map;
};

const formatOmittedPaths = (paths: readonly string[], counts: ReadonlyMap<string, DiffCounts>): string => {
  if (paths.length === 0) {
    return "";
  }
  const lines = paths.map((path) => {
    const c = counts.get(path);
    const churn = c === undefined || c.added === "-" ? "binary" : `+${c.added} -${c.deleted}`;
    return `${path} | ${churn} (generated, body omitted)`;
  });
  return `\n# Generated files changed but not shown:\n${lines.join("\n")}\n`;
};

const parseHookInterpreter = (shebangLine: string): string => {
  const line = shebangLine.trim();
  const env = /^#!\s*\/usr\/bin\/env(?:\s+(\S+))?/.exec(line);
  if (env) return env[1] === undefined || env[1] === "" ? "sh" : lastPathSegment(env[1]);
  const interp = /^#!\s*(\S+)/.exec(line);
  return interp?.[1] === undefined ? "sh" : lastPathSegment(interp[1]);
};

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
