import { describe, expect, it, vi, beforeEach } from "vitest";
import { EffortCommand } from "@/cli/effort";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "../../../test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(() => Future.resolve())
}));
vi.mock("@/infra/ui/effort-picker", () => ({
  selectOpenAIEffort: vi.fn(() => Future.resolve(Just("low")))
}));
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { error: vi.fn() }
}));

describe("EffortCommand", () => {
  beforeEach(async () => {
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(
      Future.resolve({
        commit_convention: "conventional",
        custom_template: Nothing(),
        ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
      } satisfies ConfigValue)
    );
  });

  it("persists new effort", async () => {
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(EffortCommand.create().chain((e) => e.run()));
    expect(saveConfig).toHaveBeenCalled();
  });
});
