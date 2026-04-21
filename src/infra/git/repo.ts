export {
  checkIsGitRepo,
  getStagedDiff,
  performCommit,
  performPush,
  getCurrentBranch,
  hasUpstream,
  getUpstream,
  getCommitMetadata,
  getRemoteUrl,
  type CommitMetadata,
  type PushResult,
  type PushRange
};

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CommitMetadata = {
  hash: string;
  short: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  date: Date;
};

type PushRange = { before: string; after: string };

type PushResult = {
  output: string;
  range: Maybe<PushRange>;
};

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

const execGitChecked = (args: string[], fallbackMsg: string): Future<Error, string> =>
  Future.attemptP(() => execGit(args)).chain(({ stdout, stderr, exitCode }) =>
    exitCode !== 0 ?
      Future.reject<Error, string>(new Error(stderr.trim() || stdout.trim() || fallbackMsg))
    : Future.resolve<Error, string>(stdout)
  );

const parsePushRange = (output: string): Maybe<PushRange> => {
  const m = output.match(/([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})/);
  if (!m) return Nothing();
  const [, before, after] = m;
  return before && after ? Just({ before, after }) : Nothing();
};

const checkIsGitRepo = (): Future<Error, void> =>
  execGitChecked(["rev-parse", "--is-inside-work-tree"], "Not a git repository").map(() => {});

const getStagedDiff = (): Future<Error, string> =>
  execGitChecked(["diff", "--staged"], "Failed to get staged changes").chain((stdout) =>
    stdout.trim() ?
      Future.resolve<Error, string>(stdout)
    : Future.reject<Error, string>(new Error("No staged changes found"))
  );

const performCommit = (message: string): Future<Error, string> =>
  Future.attemptP(async () => {
    const tmpPath = join(tmpdir(), `commit-msg-${Date.now()}.txt`);
    await writeFile(tmpPath, message, "utf-8");
    const res = await execGit(["commit", "-F", tmpPath]);
    await unlink(tmpPath).catch(() => {});
    return res;
  }).chain(({ stdout, stderr, exitCode }) =>
    exitCode !== 0 ?
      Future.reject<Error, string>(new Error(stderr.trim() || stdout.trim() || "Commit failed"))
    : Future.resolve<Error, string>(
        "\n" +
          stdout
            .split("\n")
            .filter((line) => !line.startsWith("["))
            .join("\n")
            .trim() +
          "\n"
      )
  );

const performPush = (branch?: string, publish = false, forceWithLease = false): Future<Error, PushResult> => {
  const args = publish && branch ? ["push", "--set-upstream", "origin", branch] : ["push"];
  if (forceWithLease) args.push("--force-with-lease");
  return Future.attemptP(() => execGit(args)).chain(({ stdout, stderr, exitCode }) =>
    exitCode !== 0 ?
      Future.reject<Error, PushResult>(new Error(stderr.trim() || stdout.trim() || "Push failed"))
    : Future.resolve<Error, PushResult>({
        output: stdout + stderr,
        range: parsePushRange(stdout + "\n" + stderr)
      })
  );
};

const getCurrentBranch = (): Future<Error, string> =>
  execGitChecked(["rev-parse", "--abbrev-ref", "HEAD"], "Failed to get current branch").map((s) => s.trim());

const hasUpstream = (): Future<Error, boolean> =>
  Future.attemptP(() => execGit(["rev-parse", "--abbrev-ref", "@{u}"])).map(({ exitCode }) => exitCode === 0);

const getUpstream = (): Future<Error, Maybe<string>> =>
  Future.attemptP(() => execGit(["rev-parse", "--abbrev-ref", "@{u}"])).map(({ stdout, exitCode }) =>
    exitCode !== 0 ? Nothing<string>() : Just(stdout.trim())
  );

const getRemoteUrl = (remote: string = "origin"): Future<Error, string> =>
  execGitChecked(["remote", "get-url", remote], `Failed to read remote '${remote}' url`).map((s) => s.trim());

const getCommitMetadata = (ref: string = "HEAD"): Future<Error, CommitMetadata> =>
  execGitChecked(["log", "-1", `--format=%H%n%h%n%s%n%an%n%ae%n%aI`, ref], "Failed to read commit metadata").chain(
    (stdout) => {
      const [hash, short, subject, authorName, authorEmail, iso] = stdout.split("\n");
      return hash && short && subject !== undefined && authorName !== undefined && authorEmail !== undefined && iso ?
          Future.resolve<Error, CommitMetadata>({ hash, short, subject, authorName, authorEmail, date: new Date(iso) })
        : Future.reject<Error, CommitMetadata>(new Error("Malformed git log output"));
    }
  );
