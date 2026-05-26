import { describe, expect, it } from "vitest";
import { Failure, Success } from "@/libs/result";
import { parseBranchSuggestions, parseAndValidateBranchSuggestions, stripOptionalJsonFence, validateGitBranchName } from "@/domain/branch/suggestions";

const oneTwoThree = '{"suggestions":[{"name":"one","rationale":"r1"},{"name":"two","rationale":"r2"},{"name":"three","rationale":"r3"}]}';

describe("stripOptionalJsonFence", () => {
  it("returns trimmed input when no fence", () => {
    expect(stripOptionalJsonFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("strips json code fence", () => {
    const raw = "```json\n" + oneTwoThree + "\n```";
    expect(stripOptionalJsonFence(raw)).toBe(oneTwoThree);
  });
});

describe("parseBranchSuggestions", () => {
  it("parses valid payload", () => {
    const r = parseBranchSuggestions(oneTwoThree);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.map((s) => s.name)).toEqual(["one", "two", "three"]);
      expect(r.value.map((s) => s.rationale)).toEqual(["r1", "r2", "r3"]);
    }
  });

  it("rejects wrong array length", () => {
    const r = parseBranchSuggestions('{"suggestions":[{"name":"a","rationale":"r"},{"name":"b","rationale":"r"}]}');
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty name", () => {
    const r = parseBranchSuggestions('{"suggestions":[{"name":"","rationale":"r"},{"name":"b","rationale":"r"},{"name":"c","rationale":"r"}]}');
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects missing rationale", () => {
    const r = parseBranchSuggestions('{"suggestions":[{"name":"a"},{"name":"b","rationale":"r"},{"name":"c","rationale":"r"}]}');
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects rationale exceeding 120 chars", () => {
    const longR = "x".repeat(121);
    const r = parseBranchSuggestions(`{"suggestions":[{"name":"a","rationale":"${longR}"},{"name":"b","rationale":"r"},{"name":"c","rationale":"r"}]}`);
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

  it("accepts change-kind word as suffix (e.g. refactor)", () => {
    const r = validateGitBranchName("frontend-list-ui-refactor");
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

  it("rejects vague verb as first segment (add-)", () => {
    expect(validateGitBranchName("add-foo") instanceof Failure).toBe(true);
  });

  it("rejects vague verb as first segment (update-)", () => {
    expect(validateGitBranchName("update-bar") instanceof Failure).toBe(true);
  });
});

describe("parseAndValidateBranchSuggestions", () => {
  it("accepts fenced JSON with valid names", () => {
    const raw =
      '```json\n{"suggestions":[{"name":"login-form-ui","rationale":"component focus"},{"name":"auth-wiring","rationale":"broader framing"},{"name":"signup-flow","rationale":"user-visible change"}]}\n```';
    const r = parseAndValidateBranchSuggestions(raw);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.map((s) => s.name)).toEqual(["login-form-ui", "auth-wiring", "signup-flow"]);
      expect(r.value.map((s) => s.rationale)).toEqual(["component focus", "broader framing", "user-visible change"]);
    }
  });

  it("rejects valid JSON but invalid git names", () => {
    const r = parseAndValidateBranchSuggestions(
      '{"suggestions":[{"name":"../evil","rationale":"r"},{"name":"b","rationale":"r"},{"name":"c","rationale":"r"}]}'
    );
    expect(r instanceof Failure).toBe(true);
  });
});
