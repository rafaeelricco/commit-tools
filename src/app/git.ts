import { Future } from "@/future";

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export class NoStagedChanges extends Error {
  constructor() {
    super("No staged changes found.");
    this.name = "NoStagedChanges";
  }
}

export class NotGitRepo extends Error {
  constructor() {
    super("Not a git repository.");
    this.name = "NotGitRepo";
  }
}

/**
 * Checks if the current directory is a git repository.
 */
export const checkGitRepo = (): Future<NotGitRepo, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new NotGitRepo();
    return process.cwd();
  }).mapRej(e => e instanceof NotGitRepo ? e : new NotGitRepo());

/**
 * Retrieves the staged diff.
 */
export const getStagedDiff = (cwd: string): Future<GitError | NoStagedChanges, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "diff", "--staged"], { cwd, stdout: "pipe" });
    const text = await new Response(proc.stdout).text();
    if (!text.trim()) throw new NoStagedChanges();
    return text;
  }).mapRej(e => e instanceof NoStagedChanges ? e : new GitError(String(e)));

/**
 * Performs a git commit.
 */
export const commit = (message: string, cwd: string): Future<GitError, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "commit", "-m", message], { cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new GitError(stderr.trim() || stdout.trim() || "Commit failed");
    return stdout;
  }).mapRej(e => e instanceof GitError ? e : new GitError(String(e)));

/**
 * Performs a git push.
 */
export const push = (cwd: string): Future<GitError, string> =>
  Future.attemptP(async () => {
    const proc = Bun.spawn(["git", "push"], { cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) throw new GitError(stderr.trim() || stdout.trim() || "Push failed");
    return stdout;
  }).mapRej(e => e instanceof GitError ? e : new GitError(String(e)));
