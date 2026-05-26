export { stripOptionalJsonFence, parseBranchSuggestions, validateGitBranchName, parseAndValidateBranchSuggestions };

import * as D from "@/libs/json/decoder";
import { Failure, Success, type Result } from "@/libs/result";

const MAX_BRANCH_NAME_LENGTH = 64;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const TRUNK_NAMES = new Set(["main", "master", "develop", "head"]);

const FORBIDDEN_FIRST_SEGMENTS = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "perf",
  "build",
  "ci",
  "style",
  "revert",
  "feature",
  "bugfix",
  "hotfix",
  "release"
]);

const threeNonEmptySuggestions: D.Decoder<readonly [string, string, string]> = D.array(D.string).chain((xs) => {
  if (xs.length !== 3) {
    return D.fail("expected exactly 3 strings in suggestions");
  }
  const trimmed = xs.map((s) => s.trim());
  if (!trimmed.every((s) => s.length > 0)) {
    return D.fail("expected 3 non-empty strings");
  }
  const a = trimmed[0];
  const b = trimmed[1];
  const c = trimmed[2];
  if (a === undefined || b === undefined || c === undefined) {
    return D.fail("expected 3 strings");
  }
  return D.succeed([a, b, c] as const);
});

const suggestionsPayloadDecoder = D.object({
  suggestions: threeNonEmptySuggestions
});

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

const parseBranchSuggestions = (raw: string): Result<Error, readonly [string, string, string]> => {
  const trimmed = stripOptionalJsonFence(raw.trim());
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return Failure(new Error("Branch suggestions: invalid JSON"));
  }
  return D.decode(json, suggestionsPayloadDecoder)
    .mapFailure((msg) => new Error(`Branch suggestions: ${msg}`))
    .map((row) => row.suggestions);
};

const validateGitBranchName = (name: string): Result<Error, string> => {
  if (name.length > MAX_BRANCH_NAME_LENGTH) {
    return Failure(new Error(`Invalid branch name (max ${MAX_BRANCH_NAME_LENGTH} characters): ${name}`));
  }
  if (!SLUG_PATTERN.test(name)) {
    return Failure(new Error(`Invalid branch name (use lowercase kebab-case, no slashes): ${name}`));
  }
  if (TRUNK_NAMES.has(name.toLowerCase())) {
    return Failure(new Error(`Reserved branch name: ${name}`));
  }
  const firstSegment = name.split("-")[0];
  if (firstSegment !== undefined && FORBIDDEN_FIRST_SEGMENTS.has(firstSegment)) {
    return Failure(new Error(`Branch name must not start with type prefix token: ${name}`));
  }
  return Success(name);
};

const parseAndValidateBranchSuggestions = (raw: string): Result<Error, readonly [string, string, string]> =>
  parseBranchSuggestions(raw).chain(([a, b, c]) =>
    validateGitBranchName(a).chain((va) => validateGitBranchName(b).chain((vb) => validateGitBranchName(c).map((vc) => [va, vb, vc] as const)))
  );
