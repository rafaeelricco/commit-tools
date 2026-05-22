import { describe, expect, it } from "vitest";
import { chdir, cwd } from "node:process";
import { runFuture } from "@test/helpers/run-future";
import { createTempGitRepo } from "@test/helpers/temp-git-repo";
import * as repo from "@/infra/git/repo";

describe("git repo integration", () => {
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
