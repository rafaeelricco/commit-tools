import { describe, expect, it } from "vitest";
import { chdir, cwd } from "node:process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFuture } from "@test/helpers/run-future";
import { createTempGitRepo } from "@test/helpers/temp-git-repo";
import * as repo from "@/infra/git/repo";

describe("git repo integration", () => {
  it("getLocalChangeContext includes unstaged diff", async () => {
    const { dir } = createTempGitRepo({ unstaged: true });
    const prev = cwd();
    chdir(dir);
    try {
      const ctx = await runFuture(repo.getLocalChangeContext());
      expect(ctx).toContain("file.txt");
      expect(ctx).toContain("--- git status --porcelain ---");
    } finally {
      chdir(prev);
    }
  });

  it("getLocalChangeContext rejects when working tree clean", async () => {
    const { dir } = createTempGitRepo({ staged: false });
    const prev = cwd();
    chdir(dir);
    try {
      await expect(runFuture(repo.getLocalChangeContext())).rejects.toThrow(repo.NO_LOCAL_CHANGES_MESSAGE);
    } finally {
      chdir(prev);
    }
  });

  it("getLocalChangeContext lists untracked file path without exposing its body", async () => {
    const secret = "DO-NOT-EXFILTRATE-secret-token";
    const { dir } = createTempGitRepo({
      untrackedFile: { path: "new-feature.ts", contents: `export const marker = "${secret}";\n` }
    });
    const prev = cwd();
    chdir(dir);
    try {
      const ctx = await runFuture(repo.getLocalChangeContext());
      expect(ctx).toContain("?? new-feature.ts");
      expect(ctx).not.toContain(secret);
      expect(ctx).not.toContain("--- untracked file:");
    } finally {
      chdir(prev);
    }
  });

  it("getLocalChangeContext enumerates files inside new untracked directories", async () => {
    const { dir } = createTempGitRepo({ staged: false });
    mkdirSync(join(dir, "newdir"));
    writeFileSync(join(dir, "newdir", "inner.ts"), "export const x = 1;\n");
    const prev = cwd();
    chdir(dir);
    try {
      const ctx = await runFuture(repo.getLocalChangeContext());
      expect(ctx).toContain("?? newdir/inner.ts");
    } finally {
      chdir(prev);
    }
  });

  it("createAndSwitchBranch switches HEAD", async () => {
    const { dir } = createTempGitRepo({ unstaged: true });
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.createAndSwitchBranch("my-work-branch"));
      const branch = await runFuture(repo.getCurrentBranch());
      expect(branch).toBe("my-work-branch");
    } finally {
      chdir(prev);
    }
  });

  it("getStagedDiff rejects when nothing staged", async () => {
    const { dir } = createTempGitRepo({ staged: false });
    const prev = cwd();
    chdir(dir);
    try {
      await expect(runFuture(repo.getStagedDiff())).rejects.toThrow(/No staged changes/);
    } finally {
      chdir(prev);
    }
  });

  it("getStagedDiff returns staged patch", async () => {
    const { dir } = createTempGitRepo({ staged: true });
    const prev = cwd();
    chdir(dir);
    try {
      const diff = await runFuture(repo.getStagedDiff());
      expect(diff).toContain("file.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit creates commit with message", async () => {
    const { dir } = createTempGitRepo({ staged: true });
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: integration test"));
      const meta = await runFuture(repo.getCommitMetadata());
      expect(meta.subject).toBe("feat: integration test");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs leaves other staged files", async () => {
    const { dir, run } = createTempGitRepo({ staged: true });
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add other.txt");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: one file", ["file.txt"]));
      const stillStaged = run("diff --staged --name-only").trim();
      expect(stillStaged).toBe("other.txt");
    } finally {
      chdir(prev);
    }
  });

  it("listStagedPaths includes both sides of a rename and apply leaves no staged deletion", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    run("mv file.txt renamed.txt");
    const prev = cwd();
    chdir(dir);
    try {
      const staged = await runFuture(repo.listStagedPaths());
      expect([...staged].sort()).toEqual(["file.txt", "renamed.txt"]);
      await runFuture(repo.performCommit("feat: rename file", staged));
      expect(run("diff --staged --name-only").trim()).toBe("");
      expect(run("ls-files").trim()).toBe("renamed.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with paths records the staged blob not the worktree", async () => {
    const { dir, run } = createTempGitRepo({ staged: true });
    writeFileSync(join(dir, "file.txt"), "hello unstaged secret\n");
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add other.txt");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: staged only", ["file.txt"]));
      expect(run("show HEAD:file.txt")).toBe("hello world\n");
      expect(run("diff --staged --name-only").trim()).toBe("other.txt");
      expect(run("diff -- file.txt")).toContain("hello unstaged secret");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs isolates files on an unborn branch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-tools-git-"));
    const run = (args: string) => execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" });
    run("init -b main");
    run('config user.email "test@example.com"');
    run('config user.name "Test"');
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: first", ["a.txt"]));
      expect(run("diff --staged --name-only").trim()).toBe("b.txt");
      expect((await runFuture(repo.getCommitMetadata())).subject).toBe("feat: first");
      expect(run("show HEAD:a.txt")).toBe("a\n");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs isolates unborn leftovers when worktree is dirty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-tools-git-"));
    const run = (args: string) => execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" });
    run("init -b main");
    run('config user.email "test@example.com"');
    run('config user.name "Test"');
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    writeFileSync(join(dir, "b.txt"), "b dirty\n");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: first", ["a.txt"]));
      expect(run("diff --staged --name-only").trim()).toBe("b.txt");
      expect(run("show :b.txt")).toBe("b\n");
      expect(run("show HEAD:a.txt")).toBe("a\n");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs ignores hook git add of later groups", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(
      hookPath,
      `#!/bin/sh
printf 'fmt-a\\n' > a.txt
printf 'fmt-b\\n' > b.txt
git add -A
`
    );
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: first", ["a.txt"]));
      expect(run("show HEAD:a.txt")).toBe("fmt-a\n");
      expect(() => run("show HEAD:b.txt")).toThrow();
      expect(run("diff --staged --name-only").trim()).toBe("b.txt");
      expect(run("show :b.txt")).toBe("b\n");
      await runFuture(repo.performCommit("feat: second", ["b.txt"]));
      expect(run("show HEAD:b.txt")).toBe("fmt-b\n");
      expect(run("diff --staged --name-only").trim()).toBe("");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs does not commit unstaged selected edits via hook git add -A", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "a.txt"), "staged safe\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    writeFileSync(join(dir, "a.txt"), "unstaged SECRET\n");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(
      hookPath,
      `#!/bin/sh
git add -A
`
    );
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: first", ["a.txt"]));
      expect(run("show HEAD:a.txt")).toBe("staged safe\n");
      expect(run("diff -- a.txt")).toContain("unstaged SECRET");
      expect(() => run("show HEAD:b.txt")).toThrow();
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs copies hook-updated blobs into the real index", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "file.txt"), "unformatted\n");
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add file.txt other.txt");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(
      hookPath,
      `#!/bin/sh
printf 'formatted\\n' > file.txt
git add file.txt
`
    );
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: formatted", ["file.txt"]));
      expect(run("show HEAD:file.txt")).toBe("formatted\n");
      expect(run("show :file.txt")).toBe("formatted\n");
      expect(run("diff --staged --name-only").trim()).toBe("other.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs rejects during a merge", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    run('commit -m "base"');
    run("checkout -b other");
    writeFileSync(join(dir, "b.txt"), "other-b\n");
    run("add b.txt");
    run('commit -m "other"');
    run("checkout main");
    writeFileSync(join(dir, "a.txt"), "main-a\n");
    writeFileSync(join(dir, "b.txt"), "main-b\n");
    run("add a.txt b.txt");
    run('commit -m "main"');
    try {
      run("merge other");
    } catch {
      // conflict on b.txt
    }
    const prev = cwd();
    chdir(dir);
    try {
      await expect(runFuture(repo.performCommit("feat: split merge", ["a.txt"]))).rejects.toThrow(/merge, rebase, cherry-pick, or revert/);
      expect(run("rev-parse -q --verify MERGE_HEAD").trim().length).toBeGreaterThan(0);
    } finally {
      chdir(prev);
    }
  });

  it("performCommit pathspecs resolve from worktree root when cwd is a subdirectory", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "nested.ts"), "export const n = 1;\n");
    run("add app/nested.ts");
    const prev = cwd();
    chdir(join(dir, "app"));
    try {
      const staged = await runFuture(repo.listStagedPaths());
      expect([...staged]).toEqual(["app/nested.ts"]);
      await runFuture(repo.performCommit("feat: nested", staged));
      expect(run("diff --staged --name-only").trim()).toBe("");
      expect((await runFuture(repo.getCommitMetadata())).subject).toBe("feat: nested");
    } finally {
      chdir(prev);
    }
  });
});
