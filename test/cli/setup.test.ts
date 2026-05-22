import { describe, expect, it, vi } from "vitest";

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
  select: vi.fn().mockResolvedValueOnce("openai").mockResolvedValueOnce("conventional").mockResolvedValueOnce("api_key"),
  confirm: vi.fn(async () => true),
  text: vi.fn(async () => "sk-test"),
  password: vi.fn(async () => "sk-test"),
  isCancel: vi.fn(() => false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));
vi.mock("@/domain/commit/models", () => ({
  fetchModels: vi.fn(() => Future.resolve([{ id: "gpt-4.1-mini", description: "fast" }]))
}));
vi.mock("@/infra/ui/model-picker", () => ({
  selectModelInteractively: vi.fn(() => Future.resolve("gpt-4.1-mini"))
}));
vi.mock("@/infra/ui/effort-picker", () => ({
  selectOpenAIEffort: vi.fn(() => Future.resolve(Just("medium" as const)))
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

describe("Setup.run", () => {
  it("saves config after wizard", async () => {
    const { saveConfig } = await import("@/infra/storage/config");
    await runFuture(Setup.create().chain((s) => s.run()));
    expect(saveConfig).toHaveBeenCalled();
  });
});
