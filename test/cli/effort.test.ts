import { describe, expect, it, vi, beforeEach } from "vitest";
import { EffortCommand } from "@/cli/effort";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(() => Future.resolve(undefined))
}));
vi.mock("@/infra/ui/effort-picker", () => ({
  selectOpenAIEffort: vi.fn(() => Future.resolve(Just("low")))
}));
vi.mock("@/domain/llm/auth-resolver", () => ({
  resolveProvider: vi.fn()
}));
vi.mock("@/domain/commit/models", () => ({
  fetchModels: vi.fn()
}));
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>)
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { error: vi.fn() }
}));

describe("EffortCommand", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(
      Future.resolve({
        commit_convention: "conventional",
        custom_template: Nothing(),
        split_commits: false,
        ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
      } satisfies ConfigValue)
    );
  });

  it("persists new effort", async () => {
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(EffortCommand.create().chain((e) => e.run()));
    expect(saveConfig).toHaveBeenCalled();
  });

  it("uses live OAuth model capabilities", async () => {
    const config: ConfigValue = {
      commit_convention: "conventional",
      custom_template: Nothing(),
      split_commits: false,
      ai: {
        provider: "openai",
        model: "gpt-5.6-sol",
        effort: Nothing(),
        auth_method: { type: "openai_oauth", content: { access_token: "access", refresh_token: "refresh", expiry_date: 0 } }
      }
    };
    const model = {
      id: "gpt-5.6-sol",
      description: "",
      openaiEffort: Just({ options: ["low", "medium", "high", "xhigh"] as const, defaultValue: "low" as const })
    };
    const storage = await import("@/infra/storage/config");
    const resolver = await import("@/domain/llm/auth-resolver");
    const models = await import("@/domain/commit/models");
    const picker = await import("@/infra/ui/effort-picker");

    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config));
    vi.mocked(resolver.resolveProvider).mockReturnValue(Future.resolve(config.ai));
    vi.mocked(models.fetchModels).mockReturnValue(Future.resolve([model]));

    await runFuture(EffortCommand.create().chain((command) => command.run()));

    expect(models.fetchModels).toHaveBeenCalledWith("openai", config.ai.auth_method);
    const [, , capabilities] = vi.mocked(picker.selectOpenAIEffort).mock.calls[0] ?? [];
    expect(capabilities).toEqual(model.openaiEffort);
  });
});
