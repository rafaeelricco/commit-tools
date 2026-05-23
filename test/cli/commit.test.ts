import { describe, expect, it, vi, beforeEach } from "vitest";

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
  getStagedDiff: vi.fn(() => Future.resolve("staged diff")),
  performCommit: vi.fn(() => Future.resolve("\n 1 file changed\n")),
  findCommitMetadata: vi.fn()
}));
vi.mock("@/domain/llm/router", () => ({
  generateCommitMessage: vi.fn(() =>
    Future.resolve({
      text: "feat: generated",
      metadata: { durationMs: 1, model: { provider: "openai", model: "m", effort: "medium" }, tokens: Nothing() }
    })
  ),
  refineCommitMessage: vi.fn()
}));
vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  select: vi.fn(async () => "commit"),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn() }
}));
vi.mock("@/infra/ui/push-note", () => ({
  renderCommitNote: vi.fn(),
  renderPushNote: vi.fn()
}));
vi.mock("@/infra/ui/spinner", () => ({
  loading: vi.fn((_a: string, _b: string, f: Future<Error, unknown>) => f as Future<Error, never>)
}));

const config = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

describe("Commit.run", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.findCommitMetadata).mockReturnValue(
      Future.resolve(Just({ hash: "h", short: "h", subject: "feat: generated", authorName: "t", authorEmail: "t@t.com", date: new Date() }))
    );
  });

  it("commits when user selects commit", async () => {
    const mode = { type: "interactive" as const };
    await runFuture(Commit.create(mode).chain((c) => c.run(mode)));
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).toHaveBeenCalledWith("feat: generated");
  });
});
