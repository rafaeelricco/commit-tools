import { describe, expect, it } from "vitest";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";
import { Just, Nothing } from "@/libs/maybe";
import { Success } from "@/libs/result";

type ConfigValue = s.Infer<typeof Config>;

const sampleConfig = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: {
    provider: "openai",
    model: "gpt-4.1-mini",
    effort: Nothing(),
    auth_method: { type: "api_key", content: "sk-test" }
  }
});

describe("Config schema", () => {
  it("round-trips openai api_key config", () => {
    const encoded = s.encode(Config, sampleConfig());
    const decoded = s.decode(Config, encoded);
    expect(decoded.isSuccess()).toBe(true);
    if (!(decoded instanceof Success)) return;
    const again = s.decode(Config, s.encode(Config, decoded.value));
    expect(again.isSuccess()).toBe(true);
    if (again instanceof Success) {
      expect(again.value.ai.provider).toBe("openai");
      expect(again.value.custom_template).toBeInstanceOf(Nothing);
    }
  });

  it("rejects invalid provider", () => {
    const bad = { ...sampleConfig(), ai: { provider: "unknown" } };
    expect(s.decode(Config, bad).isFailure()).toBe(true);
  });

  it("accepts custom convention with template", () => {
    const json = {
      ...(s.encode(Config, { ...sampleConfig(), commit_convention: "custom", custom_template: Just("Summarize:\n{diff}") }) as Record<string, unknown>),
      commit_convention: "custom"
    };
    const result = s.decode(Config, json);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success) expect(result.value.custom_template).toBeInstanceOf(Just);
  });
});
