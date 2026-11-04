import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Split, commitOptions, formatPlanNote, withEditedTitle } from "@/cli/split";
import { Future } from "@/libs/future";
import { Nothing, Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";
import { type LlmRequestMetadata } from "@/domain/llm/router";
import { buildStagedContext } from "@/domain/context/context";

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

const meta: LlmRequestMetadata = {
  durationMs: 1,
  model: { provider: "openai", model: "m", effort: "medium" },
  tokens: Nothing()
};

const runPlan = () => {
  const cfg = config();
  const context = buildStagedContext({ diff: "staged diff", generatedNote: "", importLines: "", history: "" }, ["a.ts", "b.ts"]);
  return Split.fromResolved(cfg, cfg.ai).runPlan(context, plan, meta);
};

describe("multi-line messages", () => {
  const multi = { shouldSplit: true, commits: [{ message: "Add x\n\n- Do y.", files: ["a.ts"] }] };

  it("labels the commit picker with the title only", () => {
    expect(commitOptions(multi)[0]?.label).toBe("1. Add x");
  });

  it("indents the body under its number in the plan note", () => {
    expect(formatPlanNote(multi, 1)).toContain("1. Add x\n   \n   - Do y.\n   a.ts");
  });

  it("replaces only the title when editing", () => {
    expect(withEditedTitle(multi, 0, "Add z").commits[0]).toEqual({ message: "Add z\n\n- Do y.", files: ["a.ts"] });
  });

  it("replaces a single-line message whole", () => {
    const single = { shouldSplit: true, commits: [{ message: "Add x", files: ["a.ts"] }] };
    expect(withEditedTitle(single, 0, "Add z").commits[0]?.message).toBe("Add z");
  });
});

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

  it("edits only the title of a multi-line message and commits the body", async () => {
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValueOnce("edit").mockResolvedValueOnce(0).mockResolvedValueOnce("apply");
    vi.mocked(prompts.text).mockResolvedValueOnce("Add z");
    const cfg = config();
    const context = buildStagedContext({ diff: "staged diff", generatedNote: "", importLines: "", history: "" }, ["a.ts"]);
    const multi = { shouldSplit: true, commits: [{ message: "Add x\n\n- Do y.", files: ["a.ts"] }] };

    await runFuture(Split.fromResolved(cfg, cfg.ai).runPlan(context, multi, meta));

    expect(vi.mocked(prompts.text).mock.calls[0]?.[0]).toMatchObject({ initialValue: "Add x", message: "New title (the body stays as it is)" });
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).toHaveBeenCalledWith("Add z\n\n- Do y.", ["a.ts"]);
  });

  it("does not commit when user selects cancel", async () => {
    const prompts = await import("@clack/prompts");
    vi.mocked(prompts.select).mockResolvedValue("cancel");

    await runFuture(runPlan());
    const repo = await import("@/infra/git/repo");
    expect(repo.performCommit).not.toHaveBeenCalled();
  });
});
