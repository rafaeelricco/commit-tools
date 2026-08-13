import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Split } from "@/cli/split";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

vi.mock("@/infra/git/repo", () => ({
  performCommit: vi.fn(() => Future.resolve("\n 1 file changed\n")),
  findCommitMetadata: vi.fn()
}));
vi.mock("@clack/prompts", () => ({
  note: vi.fn(),
  select: vi.fn(async () => "apply"),
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
  split_commits: false,
  ai: { provider: "openai", model: "gpt-4.1-mini", effort: Nothing(), auth_method: { type: "api_key", content: "sk" } }
});

const plan = {
  shouldSplit: true,
  commits: [
    { message: "msg one", files: ["a.ts"] },
    { message: "msg two", files: ["b.ts"] }
  ]
};

const meta = { durationMs: 1, model: { provider: "openai" as const, model: "m", effort: "medium" as const }, tokens: Nothing() };

const runPlan = () => {
  const cfg = config();
  return Split.fromResolved(cfg, cfg.ai).runPlan("staged diff", ["a.ts", "b.ts"], plan, meta);
};

describe("Split.runPlan", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.findCommitMetadata).mockReturnValue(
      Future.resolve(Just({ hash: "h", short: "h", subject: "msg two", authorName: "t", authorEmail: "t@t.com", date: new Date() }))
    );
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("apply");
    vi.mocked(prompts.isCancel).mockReturnValue(false);
  });

  it("applies each commit group with pathspecs when user selects apply", async () => {
    await runFuture(runPlan());
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).toHaveBeenNthCalledWith(1, "msg one", ["a.ts"]);
    expect(repo.performCommit).toHaveBeenNthCalledWith(2, "msg two", ["b.ts"]);
  });

  it("does not commit when user selects cancel", async () => {
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("cancel");

    await runFuture(runPlan());
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).not.toHaveBeenCalled();
  });
});
