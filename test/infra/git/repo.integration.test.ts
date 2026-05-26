import { describe, expect, it } from "vitest";
import { chdir, cwd } from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
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
});
