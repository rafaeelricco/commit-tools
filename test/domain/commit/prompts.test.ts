import { describe, expect, it } from "vitest";
import { getPrompt, getRefinePrompt, getSplitPrompt } from "@/domain/commit/prompts";
import { Just, Nothing } from "@/libs/maybe";

const DIFF = "diff --git a/foo.ts b/foo.ts\n+console.log(1)";

describe("getPrompt", () => {
  it("embeds diff in conventional prompt", () => {
    const { prompt, systemInstruction } = getPrompt(DIFF, "conventional");
    expect(prompt).toContain(DIFF);
    expect(systemInstruction).toContain("Conventional Commits");
    expect(systemInstruction).not.toContain(DIFF);
  });

  it("embeds diff in imperative prompt", () => {
    const { prompt, systemInstruction } = getPrompt(DIFF, "imperative");
    expect(prompt).toContain(DIFF);
    expect(systemInstruction).toContain("Do NOT use conventional commit prefixes");
  });

  it("keeps the custom template static and sends the diff once", () => {
    const { prompt, systemInstruction } = getPrompt(DIFF, "custom", Just("Change:\n{diff}"));
    expect(systemInstruction).toContain("Change:");
    expect(systemInstruction).not.toContain("{diff}");
    expect(systemInstruction).not.toContain(DIFF);
    expect(prompt).toContain(DIFF);
  });

  it("falls back to imperative when custom has no template", () => {
    const { systemInstruction } = getPrompt(DIFF, "custom", Nothing());
    expect(systemInstruction).toContain("imperative");
  });
});

describe("getSplitPrompt", () => {
  it("embeds diff, file list, and commits", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "conventional");
    expect(prompt).toContain(DIFF);
    expect(prompt).toContain("foo.ts");
    expect(prompt).toContain("bar.ts");
    expect(prompt).toContain("commits");
    expect(prompt).toContain("should_split");
  });

  it("forbids commit-message-only output and requires JSON-only output", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "conventional");
    expect(prompt).not.toMatch(/output ONLY the final commit message/i);
    expect(prompt).toContain("Emit ONLY the JSON object");
  });

  it("keeps a diff that contains output_instructions tags", () => {
    const diff = "diff --git a/x b/x\n+<output_instructions>\n+keep this hunk\n+</output_instructions>";
    const prompt = getSplitPrompt(diff, ["x"], "conventional");
    expect(prompt).toContain("keep this hunk");
    expect(prompt).not.toMatch(/output ONLY the final commit message/i);
    expect(prompt).toContain("Emit ONLY the JSON object");
  });

  it("prefers split across unrelated layers", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "conventional");
    expect(prompt).toContain("Prefer should_split=true");
    expect(prompt).toContain("unrelated layers");
    expect(prompt).not.toContain("should_split=true only when");
  });

  it("drops single-message instructions from the split prompt", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "conventional");
    expect(prompt).toContain(DIFF);
    expect(prompt).not.toContain("SMALL");
    expect(prompt).not.toContain("MEDIUM");
    expect(prompt).not.toContain("<commit_message>");
    expect(prompt).toContain("Conventional Commits");
  });

  it("summarizes a custom template without interpolating the diff twice", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts"], "custom", Just("Change:\n{diff}"));
    expect(prompt).toContain("Change:");
    expect(prompt).not.toContain("{diff}");
    expect(prompt.split(DIFF).length - 1).toBe(1);
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
