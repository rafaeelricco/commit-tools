import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));
vi.mock("@/infra/auth/google", () => ({
  performOAuthFlow: vi.fn()
}));
vi.mock("@/infra/auth/openai", () => ({
  performOpenAIOAuthFlow: vi.fn(),
  validateOpenAITokens: vi.fn()
}));

import { Setup } from "@/cli/setup";
import { Future } from "@/libs/future";
import { Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(async () => true),
  text: vi.fn(async () => "sk-test"),
  password: vi.fn(async () => "sk-test"),
  isCancel: vi.fn(() => false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock("@/domain/commit/models", () => ({
  fetchModels: vi.fn(() =>
    Future.resolve([
      {
        id: "gpt-4.1-mini",
        description: "fast",
        openaiEffort: Just({ options: ["low", "medium", "high", "xhigh"] as const, defaultValue: "medium" as const })
      }
    ])
  )
}));
vi.mock("@/infra/ui/model-picker", () => ({
  selectModelInteractively: vi.fn(() =>
    Future.resolve({
      id: "gpt-4.1-mini",
      description: "fast",
      openaiEffort: Just({ options: ["low", "medium", "high", "xhigh"] as const, defaultValue: "medium" as const })
    })
  )
}));
vi.mock("@/infra/ui/effort-picker", () => ({
  selectOpenAIEffort: vi.fn(() => Future.resolve(Just("medium" as const))),
  selectXaiEffort: vi.fn(() => Future.resolve(Just("low" as const)))
}));
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>),
  bracketStatus: vi.fn((_a: string, _b: string, f: (s: unknown) => Future<Error, unknown>) => f({}))
}));
vi.mock("@/infra/storage/config", () => ({
  saveConfig: vi.fn(() => Future.resolve(undefined))
}));
vi.mock("@/infra/auth/anthropic", () => ({
  validateAnthropicApiKey: vi.fn(),
  validateAnthropicSetupToken: vi.fn()
}));

/** The wizard asks provider, then convention, then split, then auth method — in that order. */
const scriptWizard = async (provider: string, convention: string, split: boolean, authMethod: string) => {
  const p = await import("@clack/prompts");
  vi.mocked(p.select).mockReset();
  vi.mocked(p.select).mockResolvedValueOnce(provider).mockResolvedValueOnce(convention).mockResolvedValueOnce(split).mockResolvedValueOnce(authMethod);
};

describe("Setup.run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves config after wizard", async () => {
    await scriptWizard("openai", "conventional", false, "api_key");
    const { saveConfig } = await import("@/infra/storage/config");

    await runFuture(Setup.create().chain((s) => s.run()));

    expect(saveConfig).toHaveBeenCalled();
  });

  it("saves an xai api_key config", async () => {
    await scriptWizard("xai", "conventional", false, "api_key");
    const { saveConfig } = await import("@/infra/storage/config");

    await runFuture(Setup.create().chain((s) => s.run()));

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ai: expect.objectContaining({ provider: "xai", auth_method: { type: "api_key", content: "sk-test" } }) })
    );
  });
});
