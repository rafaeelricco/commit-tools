import { describe, expect, it } from "vitest";
import { getPrompt, getRefinePrompt } from "@/domain/commit/prompts";
import { Just, Nothing } from "@/libs/maybe";

const DIFF = "diff --git a/foo.ts b/foo.ts\n+console.log(1)";

describe("getPrompt", () => {
  it("embeds diff in conventional prompt", () => {
    const prompt = getPrompt(DIFF, "conventional");
    expect(prompt).toContain(DIFF);
    expect(prompt).toContain("Conventional Commits");
  });

  it("embeds diff in imperative prompt", () => {
    const prompt = getPrompt(DIFF, "imperative");
    expect(prompt).toContain(DIFF);
    expect(prompt).toContain("Do NOT use conventional commit prefixes");
  });

  it("substitutes {diff} in custom template", () => {
    const prompt = getPrompt(DIFF, "custom", Just("Change:\n{diff}"));
    expect(prompt).toContain("Change:");
    expect(prompt).toContain(DIFF);
    expect(prompt).not.toContain("{diff}");
  });

  it("falls back to imperative when custom has no template", () => {
    const prompt = getPrompt(DIFF, "custom", Nothing());
    expect(prompt).toContain("imperative");
  });
});

describe("getRefinePrompt", () => {
  it("wraps diff, current message, and adjustment", () => {
    const { prompt, systemInstruction } = getRefinePrompt({
      diff: DIFF,
      currentMessage: "feat: add x",
      adjustment: "shorter"
    });
    expect(prompt).toContain("<diff>");
    expect(prompt).toContain("shorter");
    expect(systemInstruction).toContain("revise commit messages");
  });
});
