import { describe, expect, it } from "vitest";
import { Failure, Success } from "@/libs/result";
import { parseAndValidateSplitPlan } from "@/domain/split/plan";

const staged = ["a.ts", "b.ts", "c.ts"] as const;

const threeCommits = JSON.stringify({
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

  it("rejects empty commits", () => {
    const r = parseAndValidateSplitPlan('{"commits":[]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty message", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"","files":["a.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects empty files", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"feat: a","files":[]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects duplicate paths", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"feat: a","files":["a.ts"]},{"message":"feat: again","files":["a.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("rejects unknown path", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"feat: x","files":["missing.ts"]}]}', staged);
    expect(r instanceof Failure).toBe(true);
  });

  it("appends leftover staged paths", () => {
    const r = parseAndValidateSplitPlan('{"commits":[{"message":"feat: a","files":["a.ts"]}]}', staged);
    expect(r instanceof Success).toBe(true);
    if (r instanceof Success) {
      expect(r.value.commits).toEqual([
        { message: "feat: a", files: ["a.ts"] },
        { message: "Commit remaining staged changes", files: ["b.ts", "c.ts"] }
      ]);
    }
  });
});
