import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateCommitMessage, refineCommitMessage, generateSplitPlan } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import type { ProviderConfig } from "@/domain/config/config";

const mockProvider = (provider: ProviderConfig["provider"]): ProviderConfig =>
  ({
    provider,
    model: "test-model",
    effort: Nothing(),
    auth_method: { type: "api_key", content: "sk-test" }
  }) as ProviderConfig;

vi.mock("@/infra/llm/gemini", () => ({
  generateContentWithGemini: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing(), effectiveEffort: Nothing() }))
}));
vi.mock("@/infra/llm/openai", () => ({
  generateContentWithOpenAI: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing(), effectiveEffort: Nothing() }))
}));
vi.mock("@/infra/llm/anthropic", () => ({
  generateContentWithAnthropic: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing(), effectiveEffort: Nothing() }))
}));
vi.mock("@/infra/llm/xai", () => ({
  generateContentWithXai: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing(), effectiveEffort: Nothing() }))
}));

describe("generateCommitMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["gemini", "openai", "anthropic", "xai"] as const)("routes to %s provider", async (provider) => {
    const result = await runFuture(generateCommitMessage(mockProvider(provider), "diff", "conventional", Nothing()));
    expect(result.text).toBe("feat: test");
    expect(result.metadata.model.provider).toBe(provider);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("refineCommitMessage", () => {
  it("calls openai provider for openai config", async () => {
    const { generateContentWithOpenAI } = await import("@/infra/llm/openai");
    await runFuture(refineCommitMessage(mockProvider("openai"), "feat: x", "shorter", "diff"));
    expect(generateContentWithOpenAI).toHaveBeenCalled();
  });

  it("reports the effort used by the provider", async () => {
    const { generateContentWithOpenAI } = await import("@/infra/llm/openai");
    vi.mocked(generateContentWithOpenAI).mockReturnValue(
      Future.resolve({ text: "feat: test", tokens: Nothing(), effectiveEffort: Just("provider default") })
    );

    const result = await runFuture(refineCommitMessage(mockProvider("openai"), "feat: x", "shorter", "diff"));
    expect(result.metadata.model.effort).toBe("provider default");
  });
});

describe("generateSplitPlan", () => {
  it("parses provider JSON into commits", async () => {
    const { generateContentWithOpenAI } = await import("@/infra/llm/openai");
    const json = JSON.stringify({
      should_split: true,
      commits: [
        { message: "feat: a", files: ["a.ts"] },
        { message: "feat: b", files: ["b.ts"] }
      ]
    });
    vi.mocked(generateContentWithOpenAI).mockReturnValue(Future.resolve({ text: json, tokens: Nothing(), effectiveEffort: Nothing() }));

    const result = await runFuture(generateSplitPlan(mockProvider("openai"), "diff", ["a.ts", "b.ts"], "conventional", Nothing()));
    expect(result.plan.shouldSplit).toBe(true);
    expect(result.plan.commits).toEqual([
      { message: "feat: a", files: ["a.ts"] },
      { message: "feat: b", files: ["b.ts"] }
    ]);
    expect(result.metadata.model.provider).toBe("openai");
  });

  it("calls the provider with minimum effort", async () => {
    const { generateContentWithOpenAI } = await import("@/infra/llm/openai");
    vi.mocked(generateContentWithOpenAI).mockClear();
    const json = JSON.stringify({
      should_split: false,
      commits: [{ message: "feat: a", files: ["a.ts"] }]
    });
    vi.mocked(generateContentWithOpenAI).mockReturnValue(Future.resolve({ text: json, tokens: Nothing(), effectiveEffort: Just("low") }));
    const config = { ...mockProvider("openai"), effort: Just("high") } as ProviderConfig;
    await runFuture(generateSplitPlan(config, "diff", ["a.ts"], "conventional", Nothing()));
    expect(generateContentWithOpenAI.mock.calls[0]?.[0].effort).toEqual(Just("low"));
  });
});
