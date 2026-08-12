import { describe, expect, it } from "vitest";
import { withMinEffort } from "@/domain/llm/effort";
import { GEMINI_EFFORTS, type ProviderConfig } from "@/domain/config/config";
import { Just, Nothing } from "@/libs/maybe";

const base = (provider: ProviderConfig["provider"]): ProviderConfig =>
  ({
    provider,
    model: "m",
    effort: Nothing(),
    auth_method: { type: "api_key", content: "sk" }
  }) as ProviderConfig;

describe("withMinEffort", () => {
  it("forces openai low", () => {
    expect(withMinEffort(base("openai")).effort).toEqual(Just("low"));
  });
  it("forces anthropic low", () => {
    expect(withMinEffort(base("anthropic")).effort).toEqual(Just("low"));
  });
  it("forces gemini MINIMAL", () => {
    expect(withMinEffort(base("gemini")).effort).toEqual(Just(GEMINI_EFFORTS[0]));
  });
  it("forces xai low", () => {
    expect(withMinEffort(base("xai")).effort).toEqual(Just("low"));
  });
});
