export { checkIsGitRepo, getStagedDiff, performCommit, performPush, getCurrentBranch, hasUpstream };

import { Future } from "@/utils/future";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execGit = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
  new Promise((resolve, reject) => {
    const proc = spawn("git", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });

const checkIsGitRepo = (): Future<Error, void> =>
  Future.attemptP(async () => {
    const { exitCode } = await execGit(["rev-parse", "--is-inside-work-tree"]);
    if (exitCode !== 0) throw new Error("Not a git repository");
  });

const getStagedDiff = (): Future<Error, string> =>
  Future.attemptP(async () => {
    const { stdout, stderr, exitCode } = await execGit(["diff", "--staged"]);

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "Failed to get staged changes");
    }

    if (!stdout.trim()) throw new Error("No staged changes found");
    return stdout;
  });

const performCommit = (message: string): Future<Error, string> =>
  Future.attemptP(async () => {
    const tmpPath = join(tmpdir(), `commit-msg-${Date.now()}.txt`);
    await writeFile(tmpPath, message, "utf-8");

    const { stdout, stderr, exitCode } = await execGit(["commit", "-F", tmpPath]);

    await unlink(tmpPath).catch(() => {});

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || "Commit failed");
    }

    const stats = stdout
      .split("\n")
      .filter((line) => !line.startsWith("["))
      .join("\n");

    return "\n" + stats.trim() + "\n";
  });

const performPush = (branch?: string, publish = false, forceWithLease = false): Future<Error, string> =>
  Future.attemptP(async () => {
    const args = publish && branch ? ["push", "--set-upstream", "origin", branch] : ["push"];

    if (forceWithLease) args.push("--force-with-lease");

    const { stdout, stderr, exitCode } = await execGit(args);

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || stdout.trim() || "Push failed");
    }

    return stdout || stderr;
  });

const getCurrentBranch = (): Future<Error, string> =>
  Future.attemptP(async () => {
    const { stdout, exitCode } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (exitCode !== 0) throw new Error("Failed to get current branch");
    return stdout.trim();
  });

const hasUpstream = (): Future<Error, boolean> =>
  Future.attemptP(async () => {
    const { exitCode } = await execGit(["rev-parse", "--abbrev-ref", "@{u}"]);
    return exitCode === 0;
  });
