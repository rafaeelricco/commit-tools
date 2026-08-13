export {
  checkIsGitRepo,
  getStagedDiff,
  listStagedPaths,
  getLocalChangeContext,
  createAndSwitchBranch,
  performCommit,
  performPush,
  getCurrentBranch,
  findCurrentBranch,
  hasUpstream,
  getUpstream,
  getBaseBranch,
  findBaseBranch,
  getCommitMetadata,
  findCommitMetadata,
  getRemoteUrl,
  getTrackingRemoteUrl,
  findTrackingRemoteUrl,
  NO_LOCAL_CHANGES_MESSAGE,
  isNoLocalChangesError,
  type CommitMetadata,
  type PushResult,
  type PushRange
};

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Result, Failure } from "@/libs/result";
import { absurd } from "@/libs/types";
import { type BaseLookupError } from "@/infra/git/parsers";
import { execBin, type ExecResult } from "@/infra/shell";
import * as Decoder from "@/libs/json/decoder";
import { constants as fsConstants } from "node:fs";
import { access, copyFile, cp, lstat, mkdir, readdir, readlink, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
  parsePushRange,
  formatCommitOutput,
  parseBaseFromReflog,
  parseRemoteFromUpstream,
  splitCommitFields,
  commandFailureMessage
} from "@/infra/git/parsers";

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

const execGitChecked = (args: string[], fallbackMsg: string, env?: NodeJS.ProcessEnv): Future<Error, string> =>
  execBin("git", args, { GIT_LITERAL_PATHSPECS: "1", ...env }).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, string>(new Error(commandFailureMessage(failure, fallbackMsg))),
      ({ stdout }) => Future.resolve<Error, string>(stdout)
    )
  );

const splitNulPaths = (stdout: string): readonly string[] => stdout.split("\0").filter((p) => p.length > 0);

const checkIsGitRepo = (): Future<Error, void> => execGitChecked(["rev-parse", "--is-inside-work-tree"], "Not a git repository").map(() => {});

const getStagedDiff = (): Future<Error, string> =>
  execGitChecked(["diff", "--staged"], "Failed to get staged changes").chain((stdout) =>
    stdout.trim() ? Future.resolve<Error, string>(stdout) : Future.reject<Error, string>(new Error("No staged changes found"))
  );

const listStagedPaths = (): Future<Error, readonly string[]> =>
  execGitChecked(["diff", "--staged", "--name-only", "--no-renames", "-z"], "Failed to list staged files").chain((stdout) => {
    const files = splitNulPaths(stdout);
    return files.length > 0 ?
        Future.resolve<Error, readonly string[]>(files)
      : Future.reject<Error, readonly string[]>(new Error("No staged changes found"));
  });

const NO_LOCAL_CHANGES_MESSAGE = "No local changes to infer a branch name from";

const isNoLocalChangesError = (err: unknown): err is Error => err instanceof Error && err.message === NO_LOCAL_CHANGES_MESSAGE;

const getLocalChangeContext = (): Future<Error, string> =>
  execGitChecked(["diff", "HEAD"], "Failed to read local diff").chain((diffStdout) =>
    execGitChecked(["status", "--porcelain", "--untracked-files=all"], "Failed to read git status").chain((statusStdout) =>
      Future.attemptP(async () => {
        const diffPart = diffStdout.trim();
        const statusPart = statusStdout.trim();
        if (diffPart.length === 0 && statusPart.length === 0) {
          throw new Error(NO_LOCAL_CHANGES_MESSAGE);
        }
        return statusPart.length > 0 ? `${diffPart}\n\n--- git status --porcelain ---\n${statusPart}\n` : diffPart;
      })
    )
  );

const createAndSwitchBranch = (name: string): Future<Error, void> =>
  execGitChecked(["switch", "-c", name], `Failed to create branch '${name}'`).map(() => {});

const getWorkTreeRoot = (): Future<Error, string> =>
  execGitChecked(["rev-parse", "--show-toplevel"], "Failed to resolve git directory").map((s) => s.trim());

const indexEnv = (indexFile: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GIT_INDEX_FILE: indexFile,
  ...extra
});

type HookIsolation = { hooksDir: string; origPreCommit: string };

const resolveHooksDir = (root: string): Future<Error, string> =>
  execGitChecked(["-C", root, "rev-parse", "--git-path", "hooks"], "Failed to resolve git hooks").map((p) => {
    const trimmed = p.trim();
    return isAbsolute(trimmed) ? trimmed : join(root, trimmed);
  });

const copyHookEntry = async (src: string, dest: string): Promise<void> => {
  const st = await lstat(src);
  if (st.isDirectory()) {
    await cp(src, dest, { recursive: true });
    return;
  }
  await copyFile(src, dest);
};

const acquireHookIsolation = (root: string): Future<Error, HookIsolation> => {
  const hooksDir = join(tmpdir(), `commit-hooks-${Date.now()}`);
  return resolveHooksDir(root).chain((origHooks) =>
    Future.attemptP(async () => {
      await mkdir(hooksDir);
      const names = await readdir(origHooks).catch(() => [] as string[]);
      await Promise.all(names.filter((name) => name !== "pre-commit").map((name) => copyHookEntry(join(origHooks, name), join(hooksDir, name))));
      return { hooksDir, origPreCommit: join(origHooks, "pre-commit") };
    })
  );
};

const releaseHookIsolation = (iso: HookIsolation): Future<Error, void> =>
  Future.attemptP(async () => {
    await rm(iso.hooksDir, { recursive: true, force: true });
  });

const hasExecutablePreCommit = (root: string): Future<Error, boolean> =>
  resolveHooksDir(root).chain((hooks) =>
    Future.attemptP(() =>
      access(join(hooks, "pre-commit"), fsConstants.X_OK)
        .then(() => true)
        .catch(() => false)
    )
  );

type WorktreeSnapshot = { dir: string; paths: readonly string[]; checkout: readonly string[] };

const nulPathSet = (stdout: string): ReadonlySet<string> => new Set(splitNulPaths(stdout));

const indexPathSet = (root: string, tmpIndex: string, paths: readonly string[]): Future<Error, ReadonlySet<string>> =>
  paths.length === 0 ?
    Future.resolve(new Set<string>())
  : execGitChecked(["-C", root, "ls-files", "-z", "--", ...paths], "Failed to list index paths", indexEnv(tmpIndex)).map(nulPathSet);

const dirtyPathSet = (root: string, tmpIndex: string, paths: readonly string[]): Future<Error, ReadonlySet<string>> =>
  paths.length === 0 ?
    Future.resolve(new Set<string>())
  : execGitChecked(["-C", root, "diff", "--name-only", "-z", "--", ...paths], "Failed to list dirty worktree paths", indexEnv(tmpIndex)).map(nulPathSet);

const planWorktreeHide = (
  selected: readonly string[],
  inIndex: ReadonlySet<string>,
  dirty: ReadonlySet<string>
): { checkout: readonly string[]; hide: readonly string[] } => {
  const checkout = selected.filter((path) => inIndex.has(path) && dirty.has(path));
  const deleted = selected.filter((path) => !inIndex.has(path));
  return { checkout, hide: [...checkout, ...deleted] };
};

const errnoCode = (err: unknown): string | undefined => (err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined);

const isStructuralPathErr = (err: unknown): boolean => {
  const code = errnoCode(err);
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
};

const removeWorktreePath = async (path: string): Promise<void> => {
  let st;
  try {
    st = await lstat(path);
  } catch (err) {
    if (isStructuralPathErr(err)) {
      return;
    }
    throw err;
  }
  if (st.isDirectory()) {
    await rm(path, { recursive: true, force: true });
    return;
  }
  await unlink(path);
};

const snapshotWorktreeEntry = async (src: string, dest: string): Promise<void> => {
  const st = await lstat(src);
  await mkdir(dirname(dest), { recursive: true });
  if (st.isSymbolicLink()) {
    await symlink(await readlink(src), dest);
    return;
  }
  if (st.isDirectory()) {
    await cp(src, dest, { recursive: true });
    return;
  }
  await copyFile(src, dest);
};

const restoreWorktreeEntry = async (backup: string, dest: string): Promise<void> => {
  const st = await lstat(backup);
  await removeWorktreePath(dest);
  await mkdir(dirname(dest), { recursive: true });
  if (st.isSymbolicLink()) {
    await symlink(await readlink(backup), dest);
    return;
  }
  if (st.isDirectory()) {
    await cp(backup, dest, { recursive: true });
    return;
  }
  await copyFile(backup, dest);
};

const backupWorktreeFiles = (root: string, dir: string, paths: readonly string[]): Promise<void> =>
  Promise.all(
    paths.map(async (rel) => {
      try {
        await snapshotWorktreeEntry(join(root, rel), join(dir, rel));
      } catch (err) {
        if (!isStructuralPathErr(err)) {
          throw err;
        }
      }
    })
  ).then(() => {});

const acquireWorktreeSnapshot = (root: string, tmpIndex: string, selected: readonly string[]): Future<Error, WorktreeSnapshot> => {
  const dir = join(tmpdir(), `commit-wt-${Date.now()}`);
  return Future.both(indexPathSet(root, tmpIndex, selected), dirtyPathSet(root, tmpIndex, selected)).chain(([inIndex, dirty]) => {
    const { checkout, hide } = planWorktreeHide(selected, inIndex, dirty);
    const snap: WorktreeSnapshot = { dir, paths: hide, checkout };
    if (hide.length === 0) {
      return Future.resolve(snap);
    }
    return Future.attemptP(async () => {
      await mkdir(dir);
      await backupWorktreeFiles(root, dir, hide);
      await Promise.all(hide.filter((path) => !checkout.includes(path)).map((rel) => removeWorktreePath(join(root, rel))));
    })
      .chain(() =>
        checkout.length === 0 ?
          Future.resolve(snap)
        : execGitChecked(["-C", root, "checkout-index", "-f", "--", ...checkout], "Failed to isolate worktree for hooks", indexEnv(tmpIndex)).map(
            () => snap
          )
      )
      .chainRej((err) => releaseWorktreeSnapshot(root, snap).chain(() => Future.reject(err)));
  });
};

const releaseWorktreeSnapshot = (root: string, snap: WorktreeSnapshot): Future<Error, void> =>
  Future.attemptP(async () => {
    try {
      await access(snap.dir);
    } catch {
      return;
    }
    await Promise.all(
      snap.paths.map(async (rel) => {
        const backup = join(snap.dir, rel);
        const dest = join(root, rel);
        try {
          await lstat(backup);
        } catch {
          await removeWorktreePath(dest);
          return;
        }
        await restoreWorktreeEntry(backup, dest);
      })
    );
    await rm(snap.dir, { recursive: true, force: true });
  });

const runUserPreCommit = (root: string, tmpIndex: string): Future<Error, ExecResult> =>
  resolveHooksDir(root).chain((hooks) => execBin(join(hooks, "pre-commit"), [], indexEnv(tmpIndex), root));

const resetForeignIndexPaths = (root: string, tmpIndex: string, selected: readonly string[]): Future<Error, void> =>
  execGitChecked(["-C", root, "ls-files", "-z"], "Failed to list index after hook", indexEnv(tmpIndex)).chain((stdout) => {
    const keep = new Set(selected);
    return resetIndexPaths(
      root,
      tmpIndex,
      splitNulPaths(stdout).filter((path) => !keep.has(path))
    );
  });

const commitAfterHook = (root: string, messageFile: string, tmpIndex: string, selected: readonly string[]): Future<Error, ExecResult> =>
  runUserPreCommit(root, tmpIndex).chain((hookResult) =>
    hookResult.either(
      () => Future.resolve(hookResult),
      () =>
        resetForeignIndexPaths(root, tmpIndex, selected).chain(() =>
          Future.bracket(acquireHookIsolation(root), releaseHookIsolation, (iso) =>
            execBin("git", ["-C", root, "-c", `core.hooksPath=${iso.hooksDir}`, "commit", "-F", messageFile], indexEnv(tmpIndex))
          )
        )
    )
  );

const commitIsolatedIndex = (root: string, messageFile: string, tmpIndex: string, selected: readonly string[]): Future<Error, ExecResult> =>
  hasExecutablePreCommit(root).chain((hasHook) => {
    const commit = () =>
      hasHook ? commitAfterHook(root, messageFile, tmpIndex, selected) : execBin("git", ["-C", root, "commit", "-F", messageFile], indexEnv(tmpIndex));
    return hasHook ? Future.bracket(acquireWorktreeSnapshot(root, tmpIndex, selected), (snap) => releaseWorktreeSnapshot(root, snap), commit) : commit();
  });

const copyIndexFile = (root: string, dest: string): Future<Error, void> =>
  execGitChecked(["-C", root, "rev-parse", "--absolute-git-dir"], "Failed to resolve git directory").chain((gitDir) =>
    Future.attemptP(() => copyFile(join(gitDir.trim(), "index"), dest))
  );

const listStagedPathsNoRenames = (root: string): Future<Error, readonly string[]> =>
  execGitChecked(["-C", root, "diff", "--staged", "--name-only", "--no-renames", "-z"], "Failed to list staged files").map(splitNulPaths);

const resetIndexPaths = (root: string, indexFile: string, paths: readonly string[]): Future<Error, void> =>
  paths.length === 0 ?
    Future.resolve(undefined)
  : execBin("git", ["-C", root, "rev-parse", "-q", "--verify", "HEAD"]).chain((head) =>
      execGitChecked(
        head.either(
          () => ["-C", root, "rm", "--cached", "-q", "-f", "--", ...paths],
          () => ["-C", root, "reset", "-q", "HEAD", "--", ...paths]
        ),
        "Failed to isolate staged paths",
        indexEnv(indexFile)
      ).map(() => {})
    );

const reconcileCommittedIndex = (root: string, paths: readonly string[]): Future<Error, void> =>
  execGitChecked(["-C", root, "reset", "-q", "HEAD", "--", ...paths], "Failed to reconcile index after commit").map(() => {});

const finishIsolatedCommit = (root: string, paths: readonly string[], result: ExecResult): Future<Error, ExecResult> =>
  result.either(
    () => Future.resolve(result),
    () => reconcileCommittedIndex(root, paths).map(() => result)
  );

const isolateAndCommit = (root: string, messageFile: string, tmpIndex: string, paths: readonly string[]): Future<Error, ExecResult> =>
  listStagedPathsNoRenames(root).chain((staged) => {
    const keep = new Set(paths);
    const unselected = staged.filter((path) => !keep.has(path));
    return resetIndexPaths(root, tmpIndex, unselected).chain(() =>
      commitIsolatedIndex(root, messageFile, tmpIndex, paths).chain((result) => finishIsolatedCommit(root, paths, result))
    );
  });

const SEQUENCER_REFS = ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;

const refExists = (root: string, ref: string): Future<Error, boolean> =>
  execBin("git", ["-C", root, "rev-parse", "-q", "--verify", ref]).map((result) =>
    result.either(
      () => false,
      () => true
    )
  );

const rejectIfUnmergedPaths = (root: string): Future<Error, void> =>
  execGitChecked(["-C", root, "ls-files", "-u", "-z"], "Failed to list unmerged files").chain((stdout) =>
    splitNulPaths(stdout).length === 0 ?
      Future.resolve<Error, void>(undefined)
    : Future.reject<Error, void>(new Error("Cannot isolate a commit while the index has unmerged paths"))
  );

const rejectIfSequencerInProgress = (root: string): Future<Error, void> =>
  Future.traverse((ref) => refExists(root, ref), [...SEQUENCER_REFS]).chain((present) =>
    present.some(Boolean) ?
      Future.reject<Error, void>(new Error("Cannot isolate a commit while a merge, rebase, cherry-pick, or revert is in progress"))
    : rejectIfUnmergedPaths(root)
  );

const commitIsolatedPaths = (root: string, messageFile: string, paths: readonly string[]): Future<Error, ExecResult> => {
  const tmpIndex = join(tmpdir(), `commit-index-${Date.now()}`);
  return rejectIfSequencerInProgress(root).chain(() =>
    Future.bracket(
      copyIndexFile(root, tmpIndex),
      () => Future.attemptP(() => unlink(tmpIndex).catch(() => {})),
      () => isolateAndCommit(root, messageFile, tmpIndex, paths)
    )
  );
};

const performCommit = (message: string, paths: readonly string[] = []): Future<Error, string> => {
  const tmpPath = join(tmpdir(), `commit-msg-${Date.now()}.txt`);
  return getWorkTreeRoot()
    .chain((root) =>
      Future.bracket(
        Future.attemptP(() => writeFile(tmpPath, message, "utf-8")),
        () => Future.attemptP(() => unlink(tmpPath).catch(() => {})),
        () => (paths.length > 0 ? commitIsolatedPaths(root, tmpPath, paths) : execBin("git", ["-C", root, "commit", "-F", tmpPath]))
      )
    )
    .chain((result) =>
      result.either(
        (failure) => Future.reject<Error, string>(new Error(commandFailureMessage(failure, "Commit failed"))),
        ({ stdout }) => Future.resolve<Error, string>(formatCommitOutput(stdout))
      )
    );
};

const performPush = (branch?: string, publish = false, forceWithLease = false): Future<Error, PushResult> => {
  const args = publish && branch ? ["push", "--set-upstream", "origin", branch] : ["push"];
  if (forceWithLease) args.push("--force-with-lease");
  return execBin("git", args).chain((result) =>
    result.either(
      (failure) => Future.reject<Error, PushResult>(new Error(commandFailureMessage(failure, "Push failed"))),
      ({ stdout, stderr }) =>
        Future.resolve<Error, PushResult>({
          output: stdout + stderr,
          range: parsePushRange(stdout + "\n" + stderr)
        })
    )
  );
};

const getCurrentBranch = (): Future<Error, string> =>
  execGitChecked(["rev-parse", "--abbrev-ref", "HEAD"], "Failed to get current branch").map((s) => s.trim());

const findCurrentBranch = (): Future<Error, Maybe<string>> =>
  getCurrentBranch()
    .map<Maybe<string>>((branch) => Just<string>(branch))
    .chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const hasUpstream = (): Future<Error, boolean> =>
  execBin("git", ["rev-parse", "--abbrev-ref", "@{u}"]).map((result) =>
    result.either(
      () => false,
      () => true
    )
  );

const getUpstream = (): Future<Error, Maybe<string>> =>
  execBin("git", ["rev-parse", "--abbrev-ref", "@{u}"]).map((result) =>
    result.either(
      () => Nothing<string>(),
      ({ stdout }) => Just(stdout.trim())
    )
  );

const getBaseFromReflog = (branch: string): Future<Error, Result<BaseLookupError, string>> =>
  execBin("git", ["log", "-g", "--format=%gs", branch]).map((result) =>
    result.either(
      (failure) =>
        Failure<BaseLookupError, string>({
          type: "reflog-cmd-failed",
          message: commandFailureMessage(failure, "Failed to read branch reflog")
        }),
      ({ stdout }) => parseBaseFromReflog(stdout)
    )
  );

const getDefaultRemoteBranch = (): Future<Error, Maybe<string>> =>
  execBin("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).map((result) =>
    result.either(
      () => Nothing<string>(),
      ({ stdout }) => Just(stdout.trim().replace(/^origin\//, ""))
    )
  );

const getBaseBranch = (): Future<Error, Maybe<string>> =>
  getCurrentBranch().chain((branch) =>
    getBaseFromReflog(branch).chain((result) =>
      result.either(
        (err) => {
          switch (err.type) {
            case "reflog-empty":
            case "reflog-not-creation":
              return getDefaultRemoteBranch();
            case "reflog-cmd-failed":
              return Future.reject<Error, Maybe<string>>(new Error(`git reflog failed: ${err.message}`));
            default:
              return absurd(err, "BaseLookupError");
          }
        },
        (base) => (base === branch ? getDefaultRemoteBranch() : Future.resolve<Error, Maybe<string>>(Just(base)))
      )
    )
  );

const findBaseBranch = (): Future<Error, Maybe<string>> => getBaseBranch().chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const getRemoteUrl = (remote: string = "origin"): Future<Error, string> =>
  execGitChecked(["remote", "get-url", remote], `Failed to read remote '${remote}' url`).map((s) => s.trim());

const getTrackingRemoteUrl = (): Future<Error, string> =>
  getUpstream().chain((maybeRef) => {
    const remote = maybeRef instanceof Just ? parseRemoteFromUpstream(maybeRef.value) : Nothing<string>();
    return getRemoteUrl(remote instanceof Just ? remote.value : "origin");
  });

const findTrackingRemoteUrl = (): Future<Error, Maybe<string>> =>
  getTrackingRemoteUrl()
    .map<Maybe<string>>((url) => Just<string>(url))
    .chainRej(() => Future.resolve<Error, Maybe<string>>(Nothing<string>()));

const nonEmptyString: Decoder.Decoder<string> = Decoder.string.chain((s) =>
  s.length > 0 ? Decoder.always(s) : Decoder.fail("expected non-empty string")
);

const isoDate: Decoder.Decoder<Date> = nonEmptyString.chain((s) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? Decoder.fail(`invalid ISO date: ${s}`) : Decoder.always(d);
});

const commitMetadataDecoder: Decoder.Decoder<CommitMetadata> = Decoder.object({
  hash: nonEmptyString,
  short: nonEmptyString,
  subject: Decoder.string,
  authorName: Decoder.string,
  authorEmail: Decoder.string,
  date: isoDate
});

const COMMIT_FIELDS = [
  ["hash", "%H"],
  ["short", "%h"],
  ["subject", "%s"],
  ["authorName", "%an"],
  ["authorEmail", "%ae"],
  ["date", "%aI"]
] as const;

const COMMIT_FORMAT = COMMIT_FIELDS.map(([, p]) => p).join("%x00");

const getCommitMetadata = (ref: string = "HEAD"): Future<Error, CommitMetadata> =>
  execGitChecked(["log", "-1", `--format=${COMMIT_FORMAT}`, ref], "Failed to read commit metadata").chain((stdout) =>
    splitCommitFields(stdout)
      .chain((obj) => Decoder.decode(obj, commitMetadataDecoder))
      .either(
        (msg) => Future.reject<Error, CommitMetadata>(new Error(`Malformed git log output: ${msg}`)),
        (md) => Future.resolve<Error, CommitMetadata>(md)
      )
  );

const findCommitMetadata = (ref: string = "HEAD"): Future<Error, Maybe<CommitMetadata>> =>
  getCommitMetadata(ref)
    .map<Maybe<CommitMetadata>>((metadata) => Just<CommitMetadata>(metadata))
    .chainRej(() => Future.resolve<Error, Maybe<CommitMetadata>>(Nothing<CommitMetadata>()));
