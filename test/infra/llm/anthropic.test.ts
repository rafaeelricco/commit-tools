import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Config } from "@/domain/config/config";
import { generateContentWithAnthropic } from "@/infra/llm/anthropic";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

const stream = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    readonly messages = { stream };
  }
  return { default: MockAnthropic };
});

type AnthropicConfig = Extract<Config["ai"], { provider: "anthropic" }>;

const apiKeyConfig: AnthropicConfig = {
  provider: "anthropic",
  model: "claude-sonnet-5",
  effort: Just("low"),
  auth_method: { type: "api_key", content: "sk-ant-test" }
};

const setupTokenConfig: AnthropicConfig = { ...apiKeyConfig, effort: Nothing(), auth_method: { type: "anthropic_setup_token", content: "sk-ant-oat" } };

const message = { content: [{ type: "text", text: "feat: test" }], usage: { input_tokens: 1, output_tokens: 2 } };

describe("generateContentWithAnthropic", () => {
  beforeEach(() => {
    stream.mockReset();
    stream.mockReturnValue({ finalMessage: vi.fn().mockResolvedValue(message) });
  });

  it("sends the system instruction as a cacheable block and the diff as the user message", async () => {
    await runFuture(generateContentWithAnthropic(apiKeyConfig, { prompt: "diff", systemInstruction: "rules" }));
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      system: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "diff" }],
      output_config: { effort: "low" }
    });
  });

  it("omits system when there is no instruction", async () => {
    await runFuture(generateContentWithAnthropic(apiKeyConfig, { prompt: "diff" }));
    expect(stream.mock.calls[0]?.[0]).not.toHaveProperty("system");
  });

  it("marks the instruction block after the Claude Code preamble on the setup-token path", async () => {
    await runFuture(generateContentWithAnthropic(setupTokenConfig, { prompt: "diff", systemInstruction: "rules" }));
    const system = stream.mock.calls[0]?.[0].system;
    expect(system).toHaveLength(2);
    expect(system[0]).not.toHaveProperty("cache_control");
    expect(system[1]).toMatchObject({ text: "rules", cache_control: { type: "ephemeral" } });
  });
});
