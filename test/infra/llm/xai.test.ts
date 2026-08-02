import { beforeEach, describe, expect, it, vi } from "vitest";

import OpenAI from "openai";

import { type Config, type XaiEffort } from "@/domain/config/config";
import { generateContentWithXai } from "@/infra/llm/xai";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

const create = vi.hoisted(() => vi.fn());
const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();

  class MockOpenAI {
    static BadRequestError = actual.default.BadRequestError;
    static APIError = actual.default.APIError;
    readonly chat = { completions: { create } };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }

  return { default: MockOpenAI };
});

type XaiConfig = Extract<Config["ai"], { provider: "xai" }>;

const configWith = (effort: XaiConfig["effort"]): XaiConfig => ({
  provider: "xai",
  model: "grok-4.5",
  effort,
  auth_method: { type: "api_key", content: "xai-test" }
});

const completion = {
  choices: [{ message: { content: "Add retry to the token refresh" } }],
  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
};

const unsupportedEffortError = () =>
  new OpenAI.BadRequestError(
    400,
    { code: "invalid_request_error", message: "reasoning_effort is not supported for model grok-4.5" },
    undefined,
    new Headers()
  );

describe("generateContentWithXai", () => {
  beforeEach(() => {
    create.mockReset();
    constructed.length = 0;
  });

  it("targets the xAI API base URL with the configured key", async () => {
    create.mockResolvedValue(completion);

    await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }));

    expect(constructed[0]).toMatchObject({ baseURL: "https://api.x.ai/v1", apiKey: "xai-test" });
  });

  it("sends a configured effort once and reports it", async () => {
    create.mockResolvedValue(completion);

    const result = await runFuture(generateContentWithXai(configWith(Just<XaiEffort>("high")), { prompt: "diff" }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "grok-4.5", reasoning_effort: "high" });
    expect(result.text).toBe("Add retry to the token refresh");
    expect(result.effectiveEffort.expect("Expected effective effort")).toBe("high");
  });

  it("omits reasoning_effort when no effort is configured", async () => {
    create.mockResolvedValue(completion);

    const result = await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }));

    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("reasoning_effort");
    expect(result.effectiveEffort.expect("Expected effective effort")).toBe("provider default");
  });

  it("retries once without reasoning_effort when the model rejects it", async () => {
    create.mockRejectedValueOnce(unsupportedEffortError()).mockResolvedValueOnce(completion);

    const result = await runFuture(generateContentWithXai(configWith(Just<XaiEffort>("high")), { prompt: "diff" }));

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ reasoning_effort: "high" });
    expect(create.mock.calls[1]?.[0]).not.toHaveProperty("reasoning_effort");
    expect(result.effectiveEffort.expect("Expected effective effort")).toBe("provider default");
  });

  it("does not retry when no effort was sent in the first place", async () => {
    create.mockRejectedValue(unsupportedEffortError());

    await expect(runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }))).rejects.toThrow("Failed to create xAI completion");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry unrelated bad requests", async () => {
    const error = new OpenAI.BadRequestError(400, { code: "invalid_request_error", message: "messages must not be empty" }, undefined, new Headers());
    create.mockRejectedValue(error);

    await expect(runFuture(generateContentWithXai(configWith(Just<XaiEffort>("high")), { prompt: "diff" }))).rejects.toThrow(
      "Failed to create xAI completion"
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("prepends the system instruction as a system message", async () => {
    create.mockResolvedValue(completion);

    await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff", systemInstruction: "be terse" }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "diff" }
      ]
    });
  });

  it("sends only the user message when there is no system instruction", async () => {
    create.mockResolvedValue(completion);

    await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }));

    expect(create.mock.calls[0]?.[0]).toMatchObject({ messages: [{ role: "user", content: "diff" }] });
  });

  it("maps usage to token counts", async () => {
    create.mockResolvedValue(completion);

    const result = await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }));

    const tokens = result.tokens.expect("Expected token usage");
    expect(tokens.input.expect("input")).toBe(1);
    expect(tokens.output.expect("output")).toBe(2);
    expect(tokens.total.expect("total")).toBe(3);
  });

  it("reports Nothing for tokens when usage is absent", async () => {
    create.mockResolvedValue({ choices: completion.choices });

    const result = await runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }));

    expect(result.tokens).toBeInstanceOf(Nothing);
  });

  it("rejects an empty completion", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "   " } }] });

    await expect(runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }))).rejects.toThrow("Response text is empty or missing");
  });

  it("routes subscription OAuth through the CLI proxy with the user-token header", async () => {
    create.mockResolvedValue(completion);
    const config = {
      ...configWith(Nothing()),
      auth_method: { type: "xai_oauth" as const, content: { access_token: "grok-access", refresh_token: "r", expiry_date: 1 } }
    };

    await runFuture(generateContentWithXai(config, { prompt: "diff" }));

    expect(constructed[0]).toMatchObject({
      baseURL: "https://cli-chat-proxy.grok.com/v1",
      apiKey: "grok-access",
      defaultHeaders: { "X-XAI-Token-Auth": "xai-grok-cli" },
      maxRetries: 0
    });
  });

  it("points a version rejection at the constant rather than xAI's `grok update` advice", async () => {
    const error = new OpenAI.APIError(
      426,
      undefined,
      "Your Grok CLI version (none) is outdated. Please update to version 0.1.202 or later via `grok update`.",
      new Headers()
    );
    create.mockRejectedValue(error);

    await expect(runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }))).rejects.toThrow(
      /Bump XAI_CLIENT_VERSION in src\/infra\/auth\/xai\.ts/
    );
  });

  it("keeps xAI's own text so the required version is visible", async () => {
    const error = new OpenAI.APIError(426, undefined, "Please update to version 0.1.202 or later", new Headers());
    create.mockRejectedValue(error);

    await expect(runFuture(generateContentWithXai(configWith(Nothing()), { prompt: "diff" }))).rejects.toThrow(/0\.1\.202/);
  });

  it("rejects an auth method xAI does not support", async () => {
    const config = {
      ...configWith(Nothing()),
      auth_method: {
        type: "google_oauth" as const,
        content: { access_token: "a", refresh_token: "r", expiry_date: 1, token_type: "Bearer", scope: "openid" }
      }
    };

    await expect(runFuture(generateContentWithXai(config, { prompt: "diff" }))).rejects.toThrow("Unsupported auth method for xai");
  });
});
