import { describe, expect, it, vi, beforeEach } from "vitest";
import { Future } from "@/libs/future";
import { resolveProvider, tokensChanged } from "@/domain/llm/auth-resolver";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "../../../test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config as ConfigSchema } from "@/domain/config/config";

vi.mock("@/infra/auth/google", () => ({
  ensureFreshTokens: vi.fn((t: { access_token: string }) => Future.resolve({ ...t, access_token: "new-access" }))
}));
vi.mock("@/infra/auth/openai", () => ({ ensureFreshOpenAITokens: vi.fn() }));
vi.mock("@/infra/storage/config", () => ({
  updateGoogleTokens: vi.fn(() => Future.resolve()),
  updateOpenAITokens: vi.fn(() => Future.resolve())
}));

type ConfigValue = s.Infer<typeof ConfigSchema>;

const googleConfig = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: {
    provider: "gemini",
    model: "gemini-2.0",
    effort: Nothing(),
    auth_method: {
      type: "google_oauth",
      content: {
        access_token: "old",
        refresh_token: "r",
        expiry_date: 1,
        token_type: "Bearer",
        scope: "openid"
      }
    }
  }
});

describe("tokensChanged", () => {
  it("detects access_token change", () => {
    const orig = googleConfig().ai.auth_method;
    if (orig.type !== "google_oauth") throw new Error("fixture");
    const fresh = { ...orig.content, access_token: "new" };
    expect(tokensChanged(orig.content, fresh)).toBeInstanceOf(Just);
  });

  it("returns Nothing when unchanged", () => {
    const orig = googleConfig().ai.auth_method;
    if (orig.type !== "google_oauth") throw new Error("fixture");
    expect(tokensChanged(orig.content, orig.content)).toBeInstanceOf(Nothing);
  });
});

describe("resolveProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes through api_key without refresh", async () => {
    const config: ConfigValue = {
      commit_convention: "imperative",
      custom_template: Nothing(),
      ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk-x" } }
    };
    const ai = await runFuture(resolveProvider(config));
    expect(ai.auth_method.type).toBe("api_key");
  });

  it("persists google tokens when refresh changes access_token", async () => {
    const { updateGoogleTokens } = await import("@/infra/storage/config");
    await runFuture(resolveProvider(googleConfig()));
    expect(updateGoogleTokens).toHaveBeenCalledOnce();
  });
});
