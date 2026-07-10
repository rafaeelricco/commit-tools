import { beforeEach, describe, expect, it, vi } from "vitest";

import OpenAI from "openai";

import { type Config, type OpenAIEffort } from "@/domain/config/config";
import { generateContentWithOpenAI } from "@/infra/llm/openai";
import { Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

const stream = vi.hoisted(() => vi.fn());

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();

  class MockOpenAI {
    static BadRequestError = actual.default.BadRequestError;
    readonly responses = { stream };
  }

  return { default: MockOpenAI };
});

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;

const configWith = (effort: OpenAIEffort): OpenAIConfig => ({
  provider: "openai",
  model: "gpt-5.6-sol",
  effort: Just(effort),
  auth_method: { type: "api_key", content: "sk-test" }
});

const response = {
  output: [{ type: "message", content: [{ type: "output_text", text: "feat: test" }] }],
  output_text: "feat: test",
  usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 }
};

const successfulStream = () => ({
  on: vi.fn(),
  finalResponse: vi.fn().mockResolvedValue(response)
});

describe("generateContentWithOpenAI", () => {
  beforeEach(() => stream.mockReset());

  it("sends a supported effort once", async () => {
    stream.mockReturnValue(successfulStream());

    const result = await runFuture(generateContentWithOpenAI(configWith("low"), { prompt: "diff" }));

    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ reasoning: { effort: "low" } });
    expect(result.effectiveEffort.expect("Expected effective effort")).toBe("low");
  });

  it("retries an effort-specific unsupported value once without reasoning", async () => {
    const error = new OpenAI.BadRequestError(
      400,
      { code: "unsupported_value", param: "reasoning.effort", message: "Unsupported value: 'minimal' is not supported with the 'gpt-5.6-sol' model." },
      undefined,
      new Headers()
    );
    stream.mockReturnValueOnce({ on: vi.fn(), finalResponse: vi.fn().mockRejectedValue(error) }).mockReturnValueOnce(successfulStream());

    const result = await runFuture(generateContentWithOpenAI(configWith("minimal"), { prompt: "diff" }));

    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ reasoning: { effort: "minimal" } });
    expect(stream.mock.calls[1]?.[0]).not.toHaveProperty("reasoning");
    expect(result.effectiveEffort.expect("Expected effective effort")).toBe("provider default");
  });

  it("does not retry unrelated bad requests", async () => {
    const error = new OpenAI.BadRequestError(400, { code: "invalid_parameter", param: "input", message: "Invalid input." }, undefined, new Headers());
    stream.mockReturnValue({ on: vi.fn(), finalResponse: vi.fn().mockRejectedValue(error) });

    await expect(runFuture(generateContentWithOpenAI(configWith("minimal"), { prompt: "diff" }))).rejects.toThrow("Failed to create OpenAI response");
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
