import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Branch } from "@/cli/branch";
import { Future } from "@/libs/future";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

const branchMetadata = {
  durationMs: 1,
  model: { provider: "openai" as const, model: "m", effort: "medium" },
  tokens: Nothing()
};

vi.mock("@/infra/storage/config", () => ({
  loadConfig: vi.fn()
}));
vi.mock("@/domain/llm/auth-resolver", () => ({
  resolveProvider: vi.fn((c: ConfigValue) => Future.resolve(c.ai))
}));
vi.mock("@/infra/git/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infra/git/repo")>();
  return {
    ...actual,
    checkIsGitRepo: vi.fn(() => Future.resolve(undefined)),
    getLocalChangeContext: vi.fn(() => Future.resolve("diff context")),
    createAndSwitchBranch: vi.fn(() => Future.resolve(undefined)),
    findCurrentBranch: vi.fn(() => Future.resolve(Just("main"))),
    findBaseBranch: vi.fn(() => Future.resolve(Just("main")))
  };
});
vi.mock("@/domain/llm/router", () => ({
  generateBranchNameSuggestions: vi.fn(() =>
    Future.resolve({
      names: [
        { name: "login-form-ui", rationale: "component focus" },
        { name: "auth-wiring", rationale: "broader framing" },
        { name: "signup-flow", rationale: "user-visible change" }
      ] as const,
      metadata: branchMetadata
    })
  )
}));
vi.mock("@clack/prompts", () => ({
  select: vi.fn(async () => "auth-wiring"),
  confirm: vi.fn(async () => true),
  isCancel: vi.fn(() => false),
  outro: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn() }
}));
vi.mock("@/infra/ui/push-note", () => ({
  renderBranchNote: vi.fn()
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

    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.findCurrentBranch).mockReturnValue(Future.resolve(Just("main")));
    vi.mocked(repo.findBaseBranch).mockReturnValue(Future.resolve(Just("main")));
  });

  it("creates branch with selected suggestion when on base branch", async () => {
    await runFuture(Branch.create().chain((b) => b.run()));
    const repo = await import("@/infra/git/repo");
    const pushNote = await import("@/infra/ui/push-note");
    const prompts = await import("@clack/prompts");

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(repo.createAndSwitchBranch).toHaveBeenCalledWith("auth-wiring");
    expect(prompts.select).toHaveBeenCalledWith({
      message: "Create branch",
      options: [
        { value: "login-form-ui", label: "login-form-ui — component focus" },
        { value: "auth-wiring", label: "auth-wiring — broader framing" },
        { value: "signup-flow", label: "signup-flow — user-visible change" }
      ]
    });
    expect(pushNote.renderBranchNote).toHaveBeenCalledWith({
      branch: "auth-wiring",
      baseBranch: Just("main"),
      request: Just(branchMetadata)
    });
    expect(prompts.outro).toHaveBeenCalledWith(expect.stringContaining("Switched to new branch"));
  });

  it("confirms fork off non-base branch when user accepts", async () => {
    const repo = await import("@/infra/git/repo");
    const pushNote = await import("@/infra/ui/push-note");
    const prompts = await import("@clack/prompts");

    vi.mocked(repo.findCurrentBranch).mockReturnValue(Future.resolve(Just("ai-branch-creator")));
    vi.mocked(repo.findBaseBranch).mockReturnValue(Future.resolve(Just("main")));
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    await runFuture(Branch.create().chain((b) => b.run()));

    expect(prompts.log.warn).toHaveBeenCalledWith(expect.stringContaining("ai-branch-creator"));
    expect(prompts.confirm).toHaveBeenCalledWith({ message: "Create branch off 'ai-branch-creator' anyway?" });
    expect(repo.createAndSwitchBranch).toHaveBeenCalledWith("auth-wiring");
    expect(pushNote.renderBranchNote).toHaveBeenCalled();
    expect(prompts.outro).toHaveBeenCalledWith(expect.stringContaining("Switched to new branch"));
  });

  it("cancels when user declines fork off non-base branch", async () => {
    const repo = await import("@/infra/git/repo");
    const pushNote = await import("@/infra/ui/push-note");
    const prompts = await import("@clack/prompts");

    vi.mocked(repo.findCurrentBranch).mockReturnValue(Future.resolve(Just("ai-branch-creator")));
    vi.mocked(repo.findBaseBranch).mockReturnValue(Future.resolve(Just("main")));
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    await runFuture(Branch.create().chain((b) => b.run()));

    expect(prompts.confirm).toHaveBeenCalled();
    expect(repo.createAndSwitchBranch).not.toHaveBeenCalled();
    expect(pushNote.renderBranchNote).not.toHaveBeenCalled();
    expect(prompts.outro).toHaveBeenCalledWith("Operation cancelled.");
  });

  it("cancels when user dismisses fork confirmation", async () => {
    const repo = await import("@/infra/git/repo");
    const pushNote = await import("@/infra/ui/push-note");
    const prompts = await import("@clack/prompts");
    const cancelled = Symbol("cancel");

    vi.mocked(repo.findCurrentBranch).mockReturnValue(Future.resolve(Just("ai-branch-creator")));
    vi.mocked(repo.findBaseBranch).mockReturnValue(Future.resolve(Just("main")));
    vi.mocked(prompts.confirm).mockResolvedValue(cancelled as unknown as boolean);
    vi.mocked(prompts.isCancel).mockImplementation((value) => value === cancelled);

    await runFuture(Branch.create().chain((b) => b.run()));

    expect(repo.createAndSwitchBranch).not.toHaveBeenCalled();
    expect(pushNote.renderBranchNote).not.toHaveBeenCalled();
    expect(prompts.outro).toHaveBeenCalledWith("Operation cancelled.");
  });

  it("skips fork confirmation when base branch is unknown", async () => {
    const repo = await import("@/infra/git/repo");
    const prompts = await import("@clack/prompts");

    vi.mocked(repo.findCurrentBranch).mockReturnValue(Future.resolve(Just("ai-branch-creator")));
    vi.mocked(repo.findBaseBranch).mockReturnValue(Future.resolve(Nothing()));

    await runFuture(Branch.create().chain((b) => b.run()));

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(repo.createAndSwitchBranch).toHaveBeenCalledWith("auth-wiring");
  });

  it("shows informational outro when there are no local changes", async () => {
    const repo = await import("@/infra/git/repo");
    const prompts = await import("@clack/prompts");
    const router = await import("@/domain/llm/router");
    const pushNote = await import("@/infra/ui/push-note");

    vi.mocked(repo.getLocalChangeContext).mockReturnValue(Future.reject(new Error(repo.NO_LOCAL_CHANGES_MESSAGE)));

    await runFuture(Branch.create().chain((b) => b.run()));

    expect(router.generateBranchNameSuggestions).not.toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(pushNote.renderBranchNote).not.toHaveBeenCalled();
    expect(prompts.log.warn).toHaveBeenCalled();
    expect(prompts.outro).toHaveBeenCalledWith("No local changes — nothing to suggest a branch for.");
    expect(repo.createAndSwitchBranch).not.toHaveBeenCalled();
  });
});
