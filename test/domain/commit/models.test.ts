import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModels } from "@/domain/commit/models";
import { runFuture } from "@test/helpers/run-future";

const list = vi.hoisted(() => vi.fn());
const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock("openai", () => {
  class MockOpenAI {
    readonly models = { list };
    constructor(options: unknown) {
      constructed.push(options);
    }
  }

  return { default: MockOpenAI };
});

const openAIOAuth = {
  type: "openai_oauth" as const,
  content: { access_token: "access", refresh_token: "refresh", expiry_date: 0 }
};

const asyncPageOf = (ids: string[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const id of ids) yield { id };
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  list.mockReset();
  constructed.length = 0;
});

describe("fetchModels", () => {
  it("preserves supported OpenAI efforts from the Codex catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              models: [
                {
                  slug: "gpt-5.6-sol",
                  display_name: "GPT-5.6 Sol",
                  description: "",
                  default_reasoning_level: "low",
                  supported_reasoning_levels: [
                    { effort: "low" },
                    { effort: "medium" },
                    { effort: "high" },
                    { effort: "xhigh" },
                    { effort: "max" },
                    { effort: "ultra" }
                  ]
                }
              ]
            }),
            { status: 200 }
          )
      )
    );

    const [model] = await runFuture(fetchModels("openai", openAIOAuth));
    if (model === undefined) throw new Error("Expected a model");

    expect(model.openaiEffort.expect("Expected OpenAI effort capabilities")).toEqual({
      options: ["low", "medium", "high", "xhigh"],
      defaultValue: "low"
    });
  });

  it("lists xAI models sorted by id against the xAI base URL", async () => {
    list.mockResolvedValue(asyncPageOf(["grok-4.5", "grok-3"]));

    const models = await runFuture(fetchModels("xai", { type: "api_key", content: "xai-test" }));

    expect(constructed[0]).toMatchObject({ baseURL: "https://api.x.ai/v1", apiKey: "xai-test" });
    expect(models.map((m) => m.id)).toEqual(["grok-3", "grok-4.5"]);
  });

  it("filters non-chat xAI models out of the catalog", async () => {
    list.mockResolvedValue(asyncPageOf(["grok-4.5", "grok-2-image-1212", "text-embedding-3-small"]));

    const models = await runFuture(fetchModels("xai", { type: "api_key", content: "xai-test" }));

    expect(models.map((m) => m.id)).toEqual(["grok-4.5"]);
  });

  it("lists xAI models over subscription OAuth through the CLI proxy", async () => {
    list.mockResolvedValue(asyncPageOf(["grok-4.5"]));

    await runFuture(fetchModels("xai", { type: "xai_oauth", content: { access_token: "grok-access", refresh_token: "r", expiry_date: 1 } }));

    expect(constructed[0]).toMatchObject({ baseURL: "https://cli-chat-proxy.grok.com/v1", defaultHeaders: { "X-XAI-Token-Auth": "xai-grok-cli" } });
  });

  it("rejects an auth method xAI does not support", async () => {
    await expect(runFuture(fetchModels("xai", openAIOAuth))).rejects.toThrow("Unsupported auth method for xai");
  });
});
