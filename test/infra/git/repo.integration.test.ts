import { describe, expect, it } from "vitest";
import { chdir, cwd } from "node:process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

  it("getStagedDiff omits generated file bodies but names them", async () => {
    const { dir, run } = createTempGitRepo({ staged: true });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lock: 1\nlock: 2\n");
    run("add pnpm-lock.yaml");
    const prev = cwd();
    chdir(dir);
    try {
      const diff = await runFuture(repo.getStagedDiff());
      expect(diff).toContain("file.txt");
      expect(diff).not.toContain("lock: 2");
      expect(diff).toContain("pnpm-lock.yaml | +2 -0 (generated, body omitted)");
    } finally {
      chdir(prev);
    }
  });

  it("getStagedDiff resolves with a summary when only generated files are staged", async () => {
    const { dir, run } = createTempGitRepo();
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lock: 1\n");
    run("add pnpm-lock.yaml");
    const prev = cwd();
    chdir(dir);
    try {
      const diff = await runFuture(repo.getStagedDiff());
      expect(diff).toContain("pnpm-lock.yaml");
      expect(diff).not.toContain("diff --git");
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

  it("performCommit with pathspecs isolates a rename when a hook runs git add -A", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add other.txt");
    run("mv file.txt renamed.txt");
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
      const staged = await runFuture(repo.listStagedPaths());
      expect([...staged].sort()).toEqual(["file.txt", "other.txt", "renamed.txt"]);
      await runFuture(repo.performCommit("feat: rename file", ["file.txt", "renamed.txt"]));
      expect(run("diff --staged --name-only").trim()).toBe("other.txt");
      expect(run("ls-files").trim().split("\n").sort()).toEqual(["other.txt", "renamed.txt"]);
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs keeps a case-only rename when a hook runs git add -A", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add other.txt");
    run("mv -f file.txt File.txt");
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
      const staged = await runFuture(repo.listStagedPaths());
      expect([...staged].sort()).toEqual(["File.txt", "file.txt", "other.txt"]);
      await runFuture(repo.performCommit("feat: case rename", ["file.txt", "File.txt"]));
      expect(run("ls-tree -r --name-only HEAD").trim()).toBe("File.txt");
      expect(run("show HEAD:File.txt")).toBe("hello\n");
      expect(run("diff --staged --name-only").trim()).toBe("other.txt");
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

  it("performCommit with pathspecs restores an unstaged symlink retarget after a hook", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "target.txt"), "staged-target\n");
    writeFileSync(join(dir, "link-dest.txt"), "unstaged-dest\n");
    symlinkSync("target.txt", join(dir, "link"));
    run("add link");
    unlinkSync(join(dir, "link"));
    symlinkSync("link-dest.txt", join(dir, "link"));
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
      await runFuture(repo.performCommit("feat: link", ["link"]));
      expect(run("show HEAD:link").trim()).toBe("target.txt");
      expect(readlinkSync(join(dir, "link"))).toBe("link-dest.txt");
      expect(readFileSync(join(dir, "target.txt"), "utf-8")).toBe("staged-target\n");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs ignores hook git add of unstaged unrelated deletions", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "gone.txt"), "tracked\n");
    run("add gone.txt");
    run('commit -m "track gone"');
    writeFileSync(join(dir, "file.txt"), "hello staged\n");
    run("add file.txt");
    unlinkSync(join(dir, "gone.txt"));
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
      await runFuture(repo.performCommit("feat: keep", ["file.txt"]));
      expect(run("show HEAD:file.txt")).toBe("hello staged\n");
      expect(run("show HEAD:gone.txt")).toBe("tracked\n");
      expect(run("ls-files").trim().split("\n").sort()).toEqual(["file.txt", "gone.txt"]);
      expect(run("diff --staged --name-only").trim()).toBe("");
      expect(run("status --porcelain")).toContain("gone.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs ignores untracked files added by hook git add -A", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "selected.txt"), "keep\n");
    writeFileSync(join(dir, "secret.txt"), "UNTRACKED SECRET\n");
    run("add selected.txt");
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
      await runFuture(repo.performCommit("feat: selected", ["selected.txt"]));
      expect(run("show HEAD:selected.txt")).toBe("keep\n");
      expect(() => run("show HEAD:secret.txt")).toThrow();
      expect(run("status --porcelain").trim()).toBe("?? secret.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs lets hooks see glob pathspecs", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "a.txt"), "a\n");
    run("add a.txt");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(
      hookPath,
      `#!/bin/sh
files=$(git diff --cached --name-only -- '*.txt')
test -n "$files"
`
    );
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: glob hook", ["a.txt"]));
      expect(run("show HEAD:a.txt")).toBe("a\n");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs runs commit-msg from its original hook path", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    run("add a.txt b.txt");
    mkdirSync(join(dir, ".git", "hook-tools"));
    writeFileSync(join(dir, ".git", "hook-tools", "check-msg"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, ".git", "hook-tools", "check-msg"), 0o755);
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, ".git", "hooks", "pre-commit"), 0o755);
    writeFileSync(
      join(dir, ".git", "hooks", "commit-msg"),
      `#!/bin/sh
helper=$(dirname "$0")/../hook-tools/check-msg
test -x "$helper" && exec "$helper"
exit 1
`
    );
    chmodSync(join(dir, ".git", "hooks", "commit-msg"), 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: original hook path", ["a.txt"]));
      expect(run("show HEAD:a.txt")).toBe("a\n");
      expect(run("diff --staged --name-only").trim()).toBe("b.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs isolates a file-to-directory replacement when a hook exists", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "thing"), "file\n");
    run("add thing");
    run('commit -m "add thing"');
    unlinkSync(join(dir, "thing"));
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "child"), "child\n");
    run("add -A");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 0\n");
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: replace file", ["thing", "thing/child"]));
      expect(run("show HEAD:thing/child")).toBe("child\n");
      expect(run("cat-file -t HEAD:thing").trim()).toBe("tree");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs isolates a file-to-directory replacement when a hook runs git add -A", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "thing"), "file\n");
    run("add thing");
    run('commit -m "add thing"');
    unlinkSync(join(dir, "thing"));
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "child"), "child\n");
    writeFileSync(join(dir, "other.txt"), "other\n");
    run("add -A");
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
      await runFuture(repo.performCommit("feat: replace file", ["thing", "thing/child"]));
      expect(run("show HEAD:thing/child")).toBe("child\n");
      expect(run("cat-file -t HEAD:thing").trim()).toBe("tree");
      expect(run("diff --staged --name-only").trim()).toBe("other.txt");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs commits a file-to-directory child when the ancestor is unselected", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "thing"), "file\n");
    run("add thing");
    run('commit -m "add thing"');
    unlinkSync(join(dir, "thing"));
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "a"), "a\n");
    writeFileSync(join(dir, "thing", "b"), "b\n");
    run("add -A");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: add a", ["thing/a"]));
      expect(run("show HEAD:thing/a")).toBe("a\n");
      expect(run("cat-file -t HEAD:thing").trim()).toBe("tree");
      expect(run("diff --staged --name-only").trim()).toBe("thing/b");
      await runFuture(repo.performCommit("feat: delete thing", ["thing"]));
      expect(run("diff --staged --name-only").trim()).toBe("thing/b");
      await runFuture(repo.performCommit("feat: add b", ["thing/b"]));
      expect(run("show HEAD:thing/b")).toBe("b\n");
      expect(run("diff --staged --name-only").trim()).toBe("");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs keeps later descendants staged after an ancestor file-to-directory commit", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    writeFileSync(join(dir, "thing"), "file\n");
    run("add thing");
    run('commit -m "add thing"');
    unlinkSync(join(dir, "thing"));
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "a"), "a\n");
    writeFileSync(join(dir, "thing", "b"), "b\n");
    run("add -A");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: replace file", ["thing", "thing/a"]));
      expect(run("show HEAD:thing/a")).toBe("a\n");
      expect(run("cat-file -t HEAD:thing").trim()).toBe("tree");
      expect(() => run("show HEAD:thing/b")).toThrow();
      expect(run("diff --staged --name-only").trim()).toBe("thing/b");
      await runFuture(repo.performCommit("feat: add b", ["thing/b"]));
      expect(run("show HEAD:thing/b")).toBe("b\n");
      expect(run("diff --staged --name-only").trim()).toBe("");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs keeps a later ancestor file after committing a directory deletion", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "a"), "a\n");
    run("add thing");
    run('commit -m "add dir"');
    run("rm -rf thing");
    writeFileSync(join(dir, "thing"), "file\n");
    run("add -A");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: delete child", ["thing/a"]));
      expect(() => run("show HEAD:thing/a")).toThrow();
      expect(run("diff --staged --name-only").trim()).toBe("thing");
      await runFuture(repo.performCommit("feat: add file", ["thing"]));
      expect(run("show HEAD:thing")).toBe("file\n");
      expect(run("diff --staged --name-only").trim()).toBe("");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs isolates a directory-to-file replacement when a hook exists", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    mkdirSync(join(dir, "thing"));
    writeFileSync(join(dir, "thing", "child"), "child\n");
    run("add thing");
    run('commit -m "add dir"');
    run("rm -rf thing");
    writeFileSync(join(dir, "thing"), "file\n");
    run("add -A");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, "#!/bin/sh\nexit 0\n");
    chmodSync(hookPath, 0o755);
    const prev = cwd();
    chdir(dir);
    try {
      const staged = await runFuture(repo.listStagedPaths());
      await runFuture(repo.performCommit("feat: replace dir", staged));
      expect(run("show HEAD:thing")).toBe("file\n");
    } finally {
      chdir(prev);
    }
  });

  it("performCommit with pathspecs treats bracket filenames as literal pathspecs", async () => {
    const { dir, run } = createTempGitRepo({ staged: false });
    mkdirSync(join(dir, "app", "[id]"), { recursive: true });
    mkdirSync(join(dir, "app", "i"), { recursive: true });
    writeFileSync(join(dir, "app", "[id]", "page.tsx"), "bracket\n");
    writeFileSync(join(dir, "app", "i", "page.tsx"), "plain\n");
    run("add app");
    const prev = cwd();
    chdir(dir);
    try {
      await runFuture(repo.performCommit("feat: bracket route", ["app/[id]/page.tsx"]));
      expect(run("show HEAD:app/[id]/page.tsx")).toBe("bracket\n");
      expect(run("diff --staged --name-only").trim()).toBe("app/i/page.tsx");
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
      expect(readFileSync(join(dir, "file.txt"), "utf-8")).toBe("formatted\n");
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
