export { parseAndValidateSplitPlan, type SplitCommit, type SplitPlan };

import * as D from "@/libs/json/decoder";
import { Failure, Success, type Result } from "@/libs/result";

type SplitCommit = { readonly message: string; readonly files: readonly string[] };
type SplitPlan = { readonly commits: readonly SplitCommit[]; readonly shouldSplit: boolean };

const REMAINING_STAGED_MESSAGE = "Commit remaining staged changes";

const nonEmptyString = (label: string): D.Decoder<string> =>
  D.string.chain((s) => {
    const t = s.trim();
    return t.length === 0 ? D.fail(`${label} must be non-empty`) : D.succeed(t);
  });

const nonEmptyFiles: D.Decoder<readonly string[]> = D.array(nonEmptyString("file")).chain((xs) =>
  xs.length === 0 ? D.fail("files must be non-empty") : D.succeed(xs)
);

const splitCommitDecoder: D.Decoder<SplitCommit> = D.object({
  message: nonEmptyString("message"),
  files: nonEmptyFiles
});

const nonEmptyCommits: D.Decoder<readonly SplitCommit[]> = D.array(splitCommitDecoder).chain((xs) =>
  xs.length === 0 ? D.fail<readonly SplitCommit[]>("expected at least 1 commit") : D.succeed(xs)
);

const splitPlanDecoder: D.Decoder<SplitPlan> = D.object({
  should_split: D.boolean,
  commits: nonEmptyCommits
}).map(({ should_split, commits }) => ({ shouldSplit: should_split, commits }));

const stripOptionalJsonFence = (s: string): string => {
  const t = s.trim();
  if (!t.startsWith("```")) {
    return t;
  }
  const firstNl = t.indexOf("\n");
  const body = firstNl === -1 ? "" : t.slice(firstNl + 1);
  const close = body.indexOf("```");
  if (close === -1) {
    return body.trim();
  }
  return body.slice(0, close).trim();
};

const extractJsonObject = (s: string): string => {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return s;
  }
  return s.slice(start, end + 1);
};

const parseSplitPlan = (raw: string): Result<Error, SplitPlan> => {
  const trimmed = extractJsonObject(stripOptionalJsonFence(raw.trim()));
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return Failure(new Error("Split plan: invalid JSON"));
  }
  return D.decode(json, splitPlanDecoder).mapFailure((msg) => new Error(`Split plan: ${msg}`));
};

const collapseToSingleCommit = (commits: readonly SplitCommit[], leftover: readonly string[]): Result<Error, SplitPlan> => {
  const [first, ...rest] = commits;
  if (first === undefined) {
    return Failure(new Error("Split plan: expected at least 1 commit"));
  }
  return Success({
    shouldSplit: false,
    commits: [{ message: first.message, files: [...first.files, ...rest.flatMap((commit) => commit.files), ...leftover] }]
  });
};

const validateSplitPlan = (plan: SplitPlan, stagedFiles: readonly string[]): Result<Error, SplitPlan> => {
  const staged = new Set(stagedFiles);
  const seen = new Set<string>();
  for (const commit of plan.commits) {
    for (const file of commit.files) {
      if (seen.has(file)) {
        return Failure(new Error(`Split plan: duplicate path: ${file}`));
      }
      if (!staged.has(file)) {
        return Failure(new Error(`Split plan: unknown path: ${file}`));
      }
      seen.add(file);
    }
  }
  const leftover = stagedFiles.filter((file) => !seen.has(file));
  if (!plan.shouldSplit) {
    return collapseToSingleCommit(plan.commits, leftover);
  }
  if (leftover.length === 0) {
    return Success(plan);
  }
  return Success({
    shouldSplit: true,
    commits: [...plan.commits, { message: REMAINING_STAGED_MESSAGE, files: leftover }]
  });
};

const parseAndValidateSplitPlan = (raw: string, stagedFiles: readonly string[]): Result<Error, SplitPlan> =>
  parseSplitPlan(raw).chain((plan) => validateSplitPlan(plan, stagedFiles));
