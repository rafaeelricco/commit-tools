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

  it("adds grouping hints only when there are some", () => {
    expect(getSplitPrompt(DIFF, ["foo.ts"], "conventional")).not.toContain("<grouping_hints>");
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "foo.test.ts"], "conventional", Nothing(), [{ files: ["foo.test.ts", "foo.ts"], reasons: ["test"] }]);
    expect(prompt).toContain("<grouping_hints>");
    expect(prompt).toContain("- foo.test.ts, foo.ts (test)");
  });

  it("forbids listing a path in two commits", () => {
    expect(getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "conventional")).toContain("Never list a path in two commits.");
  });

  it("asks for behavior and the reason, not file names", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "imperative");
    expect(prompt).toContain("Do not list files");
    expect(prompt).toContain("the reason when the diff shows it");
    expect(prompt).toContain('"- " bullets');
  });

  it("leaves the message shape to a custom template", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "custom", Just("[area] summary"));
    expect(prompt).toContain("[area] summary");
    expect(prompt).not.toContain('"- " bullets, each ending');
    expect(prompt).not.toContain("Fall back to one commit");
    expect(prompt).not.toContain("level of detail");
  });

  it("writes examples that parse, with real line breaks in the detailed message", () => {
    const prompt = getSplitPrompt(DIFF, ["foo.ts", "bar.ts"], "imperative");
    const outputs = [...prompt.matchAll(/<output>(.*?)<\/output>/g)].map((m) => JSON.parse(m[1] ?? "") as { commits: { message: string }[] });
    expect(outputs).toHaveLength(2);
    expect(outputs[1]?.commits[1]?.message).toContain("applying\n\n- Read should_split");
  });
});

describe("getRefinePrompt", () => {
  it("wraps the diff, current message, and adjustment", () => {
    const { prompt, systemInstruction } = getRefinePrompt({
      diff: DIFF,
      currentMessage: "feat: add x",
      adjustment: "shorter"
    });
    expect(prompt).toContain(`<diff>\n${DIFF}`);
    expect(prompt).toContain("shorter");
    expect(systemInstruction).toContain("revise commit messages");
  });
});
