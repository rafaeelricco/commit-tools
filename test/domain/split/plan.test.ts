import { describe, expect, it } from "vitest";
import { Failure, Success } from "@/libs/result";
import { parseAndValidateSplitPlan } from "@/domain/split/plan";

const staged = ["a.ts", "b.ts", "c.ts"] as const;

const threeCommits = JSON.stringify({
  should_split: true,
  commits: [
    { message: "feat: a", files: ["a.ts"] },
    { message: "feat: b", files: ["b.ts"] },
    { message: "feat: c", files: ["c.ts"] }
  ]
});

describe("parseAndValidateSplitPlan", () => {
  it("parses valid 3-commit JSON", () => {
    const r = parseAndValidateSplitPlan(threeCommits, staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.commits).toEqual([
        { message: "feat: a", files: ["a.ts"] },
        { message: "feat: b", files: ["b.ts"] },
        { message: "feat: c", files: ["c.ts"] }
      ]);
    }
  });

  it("parses fenced JSON", () => {
    const r = parseAndValidateSplitPlan("```json\n" + threeCommits + "\n```", staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.commits.map((c) => c.message)).toEqual(["feat: a", "feat: b", "feat: c"]);
    }
  });

  it("parses JSON wrapped in prose", () => {
    const r = parseAndValidateSplitPlan("Here is the plan:\n" + threeCommits + "\nDone.", staged);
    expect(r instanceof Success).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const r = parseAndValidateSplitPlan("feat: add foo", staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty commits", () => {
    const r = parseAndValidateSplitPlan('{"should_split":true,"commits":[]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty message", () => {
    const r = parseAndValidateSplitPlan('{"should_split":true,"commits":[{"message":"","files":["a.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty files", () => {
    const r = parseAndValidateSplitPlan('{"should_split":true,"commits":[{"message":"feat: a","files":[]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects duplicate paths", () => {
    const r = parseAndValidateSplitPlan(
      '{"should_split":true,"commits":[{"message":"feat: a","files":["a.ts"]},{"message":"feat: again","files":["a.ts"]}]}',
      staged
    );
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects unknown path", () => {
    const r = parseAndValidateSplitPlan('{"should_split":true,"commits":[{"message":"feat: x","files":["missing.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("appends leftover staged paths", () => {
    const r = parseAndValidateSplitPlan('{"should_split":true,"commits":[{"message":"feat: a","files":["a.ts"]}]}', staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.commits).toEqual([
        { message: "feat: a", files: ["a.ts"] },
        { message: "Commit remaining staged changes", files: ["b.ts", "c.ts"] }
      ]);
    }
  });

  it("collapses extra commits when should_split is false", () => {
    const raw = JSON.stringify({
      should_split: false,
      commits: [
        { message: "feat: a", files: ["a.ts"] },
        { message: "feat: b", files: ["b.ts", "c.ts"] }
      ]
    });
    const r = parseAndValidateSplitPlan(raw, staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.shouldSplit).toBe(false);
      expect(r.value.commits).toEqual([{ message: "feat: a", files: ["a.ts", "b.ts", "c.ts"] }]);
    }
  });

  it("folds leftover into first commit when should_split is false", () => {
    const r = parseAndValidateSplitPlan('{"should_split":false,"commits":[{"message":"feat: a","files":["a.ts"]}]}', staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.shouldSplit).toBe(false);
      expect(r.value.commits).toEqual([{ message: "feat: a", files: ["a.ts", "b.ts", "c.ts"] }]);
    }
  });

  it("rejects missing should_split", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"feat: a","files":["a.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });
});
