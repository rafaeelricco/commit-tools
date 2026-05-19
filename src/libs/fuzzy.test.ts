import { describe, expect, it } from "vitest";
import { match, search } from "@/libs/fuzzy";
import { Just } from "@/libs/maybe";

describe("match", () => {
  it("matches subsequence with positive score", () => {
    const m = match("gcm", "feat: add generateCommitMessage");
    expect(m).toBeInstanceOf(Just);
    if (m instanceof Just) expect(m.value.score).toBeGreaterThan(0);
  });

  it("returns no match when chars are missing", () => {
    expect(match("zzz", "hello").isNothing()).toBe(true);
  });

  it("is case-insensitive when query has no uppercase", () => {
    expect(match("abc", "A-B-C").isJust()).toBe(true);
  });
});

describe("search", () => {
  const items = [
    { id: "gpt-4.1", label: "GPT 4.1" },
    { id: "claude-sonnet", label: "Claude Sonnet" }
  ];

  it("returns all items with zero score for empty query", () => {
    const results = search("", items, [(i) => i.label]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.match.score === 0)).toBe(true);
  });

  it("ranks better matches first", () => {
    const results = search("claude", items, [(i) => i.id, (i) => i.label]);
    expect(results[0]?.item.id).toBe("claude-sonnet");
  });
});
