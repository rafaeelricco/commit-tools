import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateCommitMessage, refineCommitMessage } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { Nothing } from "@/libs/maybe";
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
  generateContentWithGemini: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing() }))
}));
vi.mock("@/infra/llm/openai", () => ({
  generateContentWithOpenAI: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing() }))
}));
vi.mock("@/infra/llm/anthropic", () => ({
  generateContentWithAnthropic: vi.fn(() => Future.resolve({ text: "feat: test", tokens: Nothing() }))
}));

describe("generateCommitMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["gemini", "openai", "anthropic"] as const)("routes to %s provider", async (provider) => {
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
});
