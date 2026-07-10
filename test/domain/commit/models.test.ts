import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModels } from "@/domain/commit/models";
import { runFuture } from "@test/helpers/run-future";

const openAIOAuth = {
  type: "openai_oauth" as const,
  content: { access_token: "access", refresh_token: "refresh", expiry_date: 0 }
};

afterEach(() => vi.unstubAllGlobals());

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
});
