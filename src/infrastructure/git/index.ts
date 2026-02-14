import { Future } from "@/future";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export class GitError extends Error {
  constructor(public override message: string) {
    super(message);
    this.name = "GitError";
  }
}

export class NoStagedChanges extends Error {
  constructor() {
    super("No staged changes found");
    this.name = "NoStagedChanges";
  }
}

/**
 * Checks if the current directory is a git repository.
 */
export const checkIsGitRepo = (): Future<GitError, void> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new GitError("Not a git repository");
  });

/**
 * Gets the staged changes (diff).
 */
export const getStagedDiff = (): Future<GitError | NoStagedChanges, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "diff", "--staged"], {
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new GitError(stderr.trim() || "Failed to get staged changes");
    }
    if (!stdout.trim()) throw new NoStagedChanges();
    return stdout;
  });

/**
 * Performs a commit with the given message.
 */
export const performCommit = (message: string): Future<GitError, string> =>
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
      throw new GitError(stderr.trim() || stdout.trim() || "Commit failed");
    }

    // Return stats (filter out lines starting with [ which usually contain branch/commit info)
    const stats = stdout
      .split("\n")
      .filter(line => !line.startsWith("["))
      .join("\n");
    return "\n" + stats.trim() + "\n";
  });

/**
 * Pushes changes to the upstream branch or publishes if no upstream exists.
 */
export const performPush = (branch?: string, publish = false): Future<GitError, string> =>
  Future.attemptP(async () => {
    const args = publish && branch 
      ? ["push", "--set-upstream", "origin", branch] 
      : ["push"];
    
    const proc = Bun.spawn(["git", ...args], {
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new GitError(stderr.trim() || stdout.trim() || "Push failed");
    }

    return stdout || stderr;
  });

/**
 * Gets the current branch name.
 */
export const getCurrentBranch = (): Future<GitError, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new GitError("Failed to get current branch");
    return stdout.trim();
  });

/**
 * Checks if the current branch has an upstream.
 */
export const hasUpstream = (): Future<GitError, boolean> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "@{u}"], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  });
