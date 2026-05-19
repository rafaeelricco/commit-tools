import { describe, expect, it, vi, beforeEach } from "vitest";
import { ModelCommand } from "@/cli/model";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "../../../test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

const config = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: { provider: "openai", model: "old", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(() => Future.resolve())
}));
vi.mock("@/domain/llm/auth-resolver", () => ({
  resolveProvider: vi.fn((c: ConfigValue) => Future.resolve(c.ai))
}));
vi.mock("@/domain/commit/models", () => ({
  fetchModels: vi.fn(() => Future.resolve([{ id: "gpt-4.1-mini", description: "fast" }]))
}));
vi.mock("@/infra/ui/model-picker", () => ({
  selectModelInteractively: vi.fn(() => Future.resolve("gpt-4.1-mini"))
}));
vi.mock("@/infra/ui/effort-picker", () => ({
  selectOpenAIEffort: vi.fn(() => Future.resolve(Just("high")))
}));
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>)
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { error: vi.fn() }
}));

describe("ModelCommand", () => {
  beforeEach(async () => {
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
  });

  it("updates model in saved config", async () => {
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(ModelCommand.create().chain((m) => m.run()));
    expect(saveConfig).toHaveBeenCalled();
  });
});
