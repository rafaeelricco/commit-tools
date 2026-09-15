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
vi.mock("@/infra/auth/xai", () => ({
  performXaiOAuthFlow: vi.fn()
}));

import { Setup } from "@/cli/setup";
import { Future } from "@/libs/future";
import { Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

vi.mock("@/infra/auth/oauth", () => ({
  openBrowser: vi.fn(() => Future.resolve(undefined))
}));

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

  it("saves xai oauth tokens after the device login prompt", async () => {
    await scriptWizard("xai", "conventional", false, "xai_oauth");
    const { performXaiOAuthFlow } = await import("@/infra/auth/xai");
    const { saveConfig } = await import("@/infra/storage/config");
    const p = await import("@clack/prompts");

    vi.mocked(performXaiOAuthFlow).mockImplementation((hooks) =>
      hooks
        .onDeviceCode({ userCode: "BB88-BABF", verificationUri: "https://auth.x.ai/oauth2/device" })
        .chain(() => Future.resolve({ access_token: "xa", refresh_token: "xr", expiry_date: 1 }))
    );

    await runFuture(Setup.create().chain((s) => s.run()));

    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("First copy your one-time code: BB88-BABF"));
    expect(p.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("https://auth.x.ai/oauth2/device"), initialValue: true })
    );
    expect(p.log.info).toHaveBeenCalledWith("Waiting for authentication...");
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: expect.objectContaining({ provider: "xai", auth_method: expect.objectContaining({ type: "xai_oauth" }) })
      })
    );
  });

  it("logs device-login failures instead of exiting silently", async () => {
    await scriptWizard("xai", "conventional", false, "xai_oauth");
    const { performXaiOAuthFlow } = await import("@/infra/auth/xai");
    const p = await import("@clack/prompts");

    vi.mocked(performXaiOAuthFlow).mockReturnValue(Future.reject(new Error("xAI device code expired")));

    await expect(runFuture(Setup.create().chain((s) => s.run()))).rejects.toThrow("xAI device code expired");
    expect(p.log.error).toHaveBeenCalledWith(expect.stringContaining("xAI device code expired"));
  });
});
