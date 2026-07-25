export { detectProfile, ensureBinDirOnPath, isBinDirOnPath, pathExportLine, type PathSetupOutcome, type ShellProfile };

import { Future } from "@/libs/future";
import { fromOptional, type Maybe } from "@/libs/maybe";
import { aliasBinDir } from "@/infra/alias/shims";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";

type Shell = "zsh" | "bash" | "fish";
type ShellProfile = { readonly shell: Shell; readonly file: string };
type PathSetupOutcome = "added" | "already-present";

const MARKER_START = "# >>> commit-tools >>>";
const MARKER_END = "# <<< commit-tools <<<";

const profileFor = (shell: Shell): string => {
  switch (shell) {
    case "zsh":
      return resolve(homedir(), ".zshrc");
    case "bash":
      return resolve(homedir(), ".bashrc");
    case "fish":
      return resolve(homedir(), ".config", "fish", "config.fish");
  }
};

const shellFromPath = (shellPath: string): Maybe<Shell> => {
  const name = shellPath.split("/").pop() ?? "";
  return fromOptional((["zsh", "bash", "fish"] as const).find((s) => s === name));
};

const detectProfile = (): Maybe<ShellProfile> => shellFromPath(process.env["SHELL"] ?? "").map((shell) => ({ shell, file: profileFor(shell) }));

const isBinDirOnPath = (): boolean => (process.env["PATH"] ?? "").split(delimiter).some((dir) => dir && resolve(dir) === aliasBinDir());

const pathExportLine = (shell: Shell): string => (shell === "fish" ? `fish_add_path ${aliasBinDir()}` : `export PATH="${aliasBinDir()}:$PATH"`);

const managedBlock = (shell: Shell): string => ["", MARKER_START, pathExportLine(shell), MARKER_END, ""].join("\n");

const readProfile = async (file: string): Promise<string> =>
  readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "";
    throw err;
  });

const fileExists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false
  );

/** Prefer an existing login file; otherwise create `.bash_profile` on first setup. */
const bashLoginFile = async (): Promise<string> => {
  for (const name of [".bash_profile", ".bash_login", ".profile"] as const) {
    const path = resolve(homedir(), name);
    if (await fileExists(path)) return path;
  }
  return resolve(homedir(), ".bash_profile");
};

/** Bash login shells skip `.bashrc` unless sourced — dual-write interactive + login. */
const filesFor = async (profile: ShellProfile): Promise<readonly string[]> => {
  if (profile.shell !== "bash") return [profile.file];
  const login = await bashLoginFile();
  return login === profile.file ? [profile.file] : [profile.file, login];
};

const ensureManagedBlock = async (file: string, shell: Shell): Promise<PathSetupOutcome> => {
  const current = await readProfile(file);
  if (current.includes(MARKER_START)) return "already-present";

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, current + managedBlock(shell), "utf-8");
  return "added";
};

/** Idempotent: an existing managed block is left untouched. Only ever called after an explicit confirmation. */
const ensureBinDirOnPath = (profile: ShellProfile): Future<Error, PathSetupOutcome> =>
  Future.attemptP(async () => {
    const files = await filesFor(profile);
    const outcomes = await Promise.all(files.map((file) => ensureManagedBlock(file, profile.shell)));
    return outcomes.some((o) => o === "added") ? ("added" as const) : ("already-present" as const);
  });
