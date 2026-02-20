export {
  checkIsGitRepo,
  getStagedDiff,
  performCommit,
  performPush,
  getCurrentBranch,
  hasUpstream,
};

import { Future } from "@/libs/future";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const checkIsGitRepo = (): Future<Error, void> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error("Not a git repository");
  });

const getStagedDiff = (): Future<Error, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "diff", "--staged"], { stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr.trim() || "Failed to get staged changes");
    }

    if (!stdout.trim()) throw new Error("No staged changes found");
    return stdout;
  });

const performCommit = (message: string): Future<Error, string> =>
  Future.attemptP(async () => {
    const tmpPath = join(tmpdir(), `commit-msg-${Date.now()}.txt`);
    await Bun.write(tmpPath, message);

    const proc = Bun.spawn(["git", "commit", "-F", tmpPath], {
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    await unlink(tmpPath).catch(() => {});

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(stderr.trim() || stdout.trim() || "Commit failed");
    }

    const stats = stdout
      .split("\n")
      .filter((line) => !line.startsWith("["))
      .join("\n");

    return "\n" + stats.trim() + "\n";
  });

const performPush = (branch?: string, publish = false): Future<Error, string> =>
  Future.attemptP(async () => {
    const args =
      publish && branch
        ? ["push", "--set-upstream", "origin", branch]
        : ["push"];

    const proc = Bun.spawn(["git", ...args], { stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || "Push failed");
    }

    return stdout || stderr;
  });

const getCurrentBranch = (): Future<Error, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new Error("Failed to get current branch");
    return stdout.trim();
  });

const hasUpstream = (): Future<Error, boolean> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "@{u}"], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  });
