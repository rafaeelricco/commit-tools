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
  listStagedPaths: vi.fn(() => Future.resolve(["a.ts"])),
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
  generateSplitPlan: vi.fn(() =>
    Future.resolve({
      plan: {
        shouldSplit: false,
        commits: [{ message: "feat: one", files: ["a.ts", "b.ts"] }]
      },
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

const config = (split_commits = false): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  split_commits,
  ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

describe("Commit.run", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config()));
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.listStagedPaths).mockReturnValue(Future.resolve(["a.ts"]));
    vi.mocked(repo.findCommitMetadata).mockReturnValue(
      Future.resolve(Just({ hash: "h", short: "h", subject: "feat: generated", authorName: "t", authorEmail: "t@t.com", date: new Date() }))
    );
    const router = await import("@/domain/llm/router");
    vi.mocked(router.generateSplitPlan).mockReturnValue(
      Future.resolve({
        plan: {
          shouldSplit: false,
          commits: [{ message: "feat: one", files: ["a.ts", "b.ts"] }]
        },
        metadata: { durationMs: 1, model: { provider: "openai", model: "m", effort: "medium" }, tokens: Nothing() }
      })
    );
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("commit");
  });

  it("commits when user selects commit", async () => {
    await runFuture(Commit.create().chain((c) => c.run()));
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).toHaveBeenCalledWith("feat: generated");
  });

  it("does not analyze when split is disabled and two files are staged", async () => {
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.listStagedPaths).mockReturnValue(Future.resolve(["a.ts", "b.ts"]));

    await runFuture(Commit.create().chain((c) => c.run()));

    const router = await import("@/domain/llm/router");
    expect(router.generateCommitMessage).toHaveBeenCalled();
    expect(router.generateSplitPlan).not.toHaveBeenCalled();
    expect(repo.performCommit).toHaveBeenCalledWith("feat: generated");
  });

  it("applies a split plan when auto-analysis says to split", async () => {
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config(true)));
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.listStagedPaths).mockReturnValue(Future.resolve(["a.ts", "b.ts"]));
    const router = await import("@/domain/llm/router");
    vi.mocked(router.generateSplitPlan).mockReturnValue(
      Future.resolve({
        plan: {
          shouldSplit: true,
          commits: [
            { message: "msg one", files: ["a.ts"] },
            { message: "msg two", files: ["b.ts"] }
          ]
        },
        metadata: { durationMs: 1, model: { provider: "openai", model: "m", effort: "medium" }, tokens: Nothing() }
      })
    );
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("apply");

    await runFuture(Commit.create().chain((c) => c.run()));

    expect(router.generateSplitPlan).toHaveBeenCalled();
    expect(router.generateCommitMessage).not.toHaveBeenCalled();
    expect(repo.performCommit).toHaveBeenNthCalledWith(1, "msg one", ["a.ts"]);
    expect(repo.performCommit).toHaveBeenNthCalledWith(2, "msg two", ["b.ts"]);
  });

  it("commits the single analysis message when shouldSplit is false", async () => {
    const storage = await import("@/infra/storage/config");
    vi.mocked(storage.loadConfig).mockReturnValue(Future.resolve(config(true)));
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.listStagedPaths).mockReturnValue(Future.resolve(["a.ts", "b.ts"]));

    await runFuture(Commit.create().chain((c) => c.run()));

    const router = await import("@/domain/llm/router");
    expect(router.generateSplitPlan).toHaveBeenCalled();
    expect(router.generateCommitMessage).not.toHaveBeenCalled();
    expect(repo.performCommit).toHaveBeenCalledWith("feat: one");
  });

  it("forces a split plan when the user picks Split", async () => {
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.listStagedPaths).mockReturnValue(Future.resolve(["a.ts", "b.ts"]));
    const router = await import("@/domain/llm/router");
    vi.mocked(router.generateSplitPlan).mockReturnValue(
      Future.resolve({
        plan: {
          shouldSplit: true,
          commits: [
            { message: "msg one", files: ["a.ts"] },
            { message: "msg two", files: ["b.ts"] }
          ]
        },
        metadata: { durationMs: 1, model: { provider: "openai", model: "m", effort: "medium" }, tokens: Nothing() }
      })
    );
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValueOnce("split").mockResolvedValueOnce("apply");

    await runFuture(Commit.create().chain((c) => c.run()));

    expect(router.generateCommitMessage).toHaveBeenCalled();
    expect(router.generateSplitPlan).toHaveBeenCalled();
    expect(repo.performCommit).toHaveBeenNthCalledWith(1, "msg one", ["a.ts"]);
    expect(repo.performCommit).toHaveBeenNthCalledWith(2, "msg two", ["b.ts"]);
  });
});
