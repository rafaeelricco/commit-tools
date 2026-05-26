import { describe, expect, it } from "vitest";
import { Failure, Success } from "@/libs/result";
import { parseBranchSuggestions, parseAndValidateBranchSuggestions, stripOptionalJsonFence, validateGitBranchName } from "@/domain/branch/suggestions";

describe("stripOptionalJsonFence", () => {
  it("returns trimmed input when no fence", () => {
    expect(stripOptionalJsonFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("strips json code fence", () => {
    const raw = '```json\n{"suggestions":["a","b","c"]}\n```';
    expect(stripOptionalJsonFence(raw)).toBe('{"suggestions":["a","b","c"]}');
  });
});

describe("parseBranchSuggestions", () => {
  it("parses valid payload", () => {
    const r = parseBranchSuggestions('{"suggestions":["one","two","three"]}');
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) expect(r.value).toEqual(["one", "two", "three"]);
  });

  it("rejects wrong array length", () => {
    const r = parseBranchSuggestions('{"suggestions":["a","b"]}');
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty string in array", () => {
    const r = parseBranchSuggestions('{"suggestions":["a","","c"]}');
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const r = parseBranchSuggestions("not json");
    expect(r instanceof Failure).toBe(true);
  });
});

describe("validateGitBranchName", () => {
  it("accepts kebab-case slug", () => {
    const r = validateGitBranchName("login-form-ui");
    expect(r instanceof Success).toBe(true);
  });

  it("rejects slashes", () => {
    const r = validateGitBranchName("feat/foo");
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects reserved trunk names", () => {
    expect(validateGitBranchName("main") instanceof Failure).toBe(true);
  });

  it("rejects type-first-segment", () => {
    expect(validateGitBranchName("feat-login-form") instanceof Failure).toBe(true);
  });
});

describe("parseAndValidateBranchSuggestions", () => {
  it("accepts fenced JSON with valid names", () => {
    const raw = '```json\n{"suggestions":["login-form-ui","auth-wiring","signup-flow"]}\n```';
    const r = parseAndValidateBranchSuggestions(raw);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value).toEqual(["login-form-ui", "auth-wiring", "signup-flow"]);
    }
  });

  it("rejects valid JSON but invalid git names", () => {
    const r = parseAndValidateBranchSuggestions('{"suggestions":["../evil","b","c"]}');
    expect(r instanceof Failure).toBe(true);
  });
});
