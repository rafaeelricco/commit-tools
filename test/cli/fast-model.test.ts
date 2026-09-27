import { describe, expect, it, vi, beforeEach } from "vitest";
import { FastModelCommand } from "@/cli/fast-model";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

const config = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  split_commits: false,
  fast_model: Nothing(),
  ai: { provider: "openai", model: "old", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(() => Future.resolve(undefined))
}));
vi.mock("@/domain/llm/auth-resolver", () => ({
  resolveProvider: vi.fn((c: ConfigValue) => Future.resolve(c.ai))
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
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>)
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(async () => "pick"),
  isCancel: vi.fn(() => false),
  log: { error: vi.fn() }
}));

describe("FastModelCommand", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("pick");
    vi.mocked(prompts.isCancel).mockReturnValue(false);
  });

  it("saves the picked model as the fast model", async () => {
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(FastModelCommand.create().chain((f) => f.run()));
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ fast_model: Just("gpt-4.1-mini") }));
  });

  it("saves the sign-in refreshed by resolveProvider, not the one loaded from disk", async () => {
    const auth = await import("@/domain/llm/auth-resolver");
    const refreshed = { ...config().ai, auth_method: { type: "api_key" as const, content: "sk-refreshed" } };
    vi.mocked(auth.resolveProvider).mockReturnValueOnce(Future.resolve(refreshed));
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(FastModelCommand.create().chain((f) => f.run()));
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ ai: refreshed }));
  });

  it("clears the fast model without fetching models", async () => {
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("main");
    const { saveConfig } = await import("@/infra/storage/config");
    const { fetchModels } = await import("@/domain/commit/models");
    await runFuture(FastModelCommand.create().chain((f) => f.run()));
    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ fast_model: Nothing() }));
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("saves nothing when the prompt is cancelled", async () => {
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.isCancel).mockReturnValue(true);
    const { saveConfig } = await import("@/infra/storage/config");
    await expect(runFuture(FastModelCommand.create().chain((f) => f.run()))).rejects.toThrow("Selection cancelled");
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
