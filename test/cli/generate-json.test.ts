import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Commit } from "@/cli/commit";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
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
  getStagedDiff: vi.fn(() => Future.resolve("diff")),
  performCommit: vi.fn(() => Future.resolve("")),
  performPush: vi.fn(() => Future.resolve({ output: "", range: Nothing() })),
  hasUpstream: vi.fn(() => Future.resolve(true)),
  findCommitMetadata: vi.fn()
}));
vi.mock("@/domain/llm/router", () => ({
  generateCommitMessage: vi.fn(() =>
    Future.resolve({
      text: "feat: generated",
      metadata: {
        durationMs: 1,
        model: { provider: "openai", model: "m", effort: "medium" },
        tokens: Nothing()
      }
    })
  ),
  refineCommitMessage: vi.fn(() =>
    Future.resolve({
      text: "feat: refined",
      metadata: {
        durationMs: 2,
        model: { provider: "openai", model: "m", effort: "medium" },
        tokens: Nothing()
      }
    })
  )
}));
vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn() }
}));

const config = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

const jsonMode = (overrides: Partial<{ dryRun: boolean; git: { type: "none" } | { type: "commit" } }> = {}) => ({
  type: "json" as const,
  adjust: Nothing<string>(),
  dryRun: false,
  git: { type: "none" as const },
  ...overrides
});

describe("Commit.run json mode", () => {
  let stdout: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.findCommitMetadata).mockReturnValue(
      Future.resolve(Just({ hash: "h", short: "h", subject: "feat: generated", authorName: "t", authorEmail: "t@t.com", date: new Date("2020-01-01") }))
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON to stdout without calling select", async () => {
    const clack = await import("@clack/prompts");
    const mode = jsonMode();
    await runFuture(Commit.create(mode).chain((c) => c.run(mode)));
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.message).toBe("feat: generated");
    expect(parsed.actions.committed).toBe(false);
    expect(clack.select).not.toHaveBeenCalled();
  });

  it("commits when --commit", async () => {
    const repo = await import("@/infra/git/repo");
    const mode = jsonMode({ git: { type: "commit" } });
    await runFuture(Commit.create(mode).chain((c) => c.run(mode)));
    expect(repo.performCommit).toHaveBeenCalledWith("feat: generated");
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.actions.committed).toBe(true);
  });

  it("dry-run skips commit", async () => {
    const repo = await import("@/infra/git/repo");
    const mode = { ...jsonMode(), dryRun: true };
    await runFuture(Commit.create(mode).chain((c) => c.run(mode)));
    expect(repo.performCommit).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.trim()).actions.dryRun).toBe(true);
  });
});
