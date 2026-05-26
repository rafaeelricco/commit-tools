import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Branch } from "@/cli/branch";
import { Future } from "@/libs/future";
import { Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn()
}));
vi.mock("@/domain/llm/auth-resolver", () => ({
  resolveProvider: vi.fn((c: ConfigValue) => Future.resolve(c.ai))
}));
vi.mock("@/infra/git/repo", () => ({
  checkIsGitRepo: vi.fn(() => Future.resolve(undefined)),
  getLocalChangeContext: vi.fn(() => Future.resolve("diff context")),
  createAndSwitchBranch: vi.fn(() => Future.resolve(undefined))
}));
vi.mock("@/domain/llm/router", () => ({
  generateBranchNameSuggestions: vi.fn(() =>
    Future.resolve({
      names: ["login-form-ui", "auth-wiring", "signup-flow"] as const,
      metadata: { durationMs: 1, model: { provider: "openai", model: "m", effort: "medium" }, tokens: Nothing() }
    })
  )
}));
vi.mock("@clack/prompts", () => ({
  select: vi.fn(async () => "auth-wiring"),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn() }
}));
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>)
}));

const config = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

describe("Branch.run", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
  });

  it("creates branch with selected suggestion", async () => {
    await runFuture(Branch.create().chain((b) => b.run()));
    const repo = await import("@/infra/git/repo");
    expect(repo.createAndSwitchBranch).toHaveBeenCalledWith("auth-wiring");
  });
});
