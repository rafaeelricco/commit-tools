export { aliasBinDir, findConflictingBinary, reconcileShims, removeShim, shimPath, writeShim };

import { Future } from "@/libs/future";
import { fromOptional, type Maybe } from "@/libs/maybe";
import { type Alias, type AliasName } from "@/domain/alias/alias";
import { configDir } from "@/infra/storage/config";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

const aliasBinDir = (): string => resolve(configDir(), "bin");

/** Safe to join: `AliasName.parse` already excluded separators and traversal segments. */
const shimPath = (name: AliasName): string => resolve(aliasBinDir(), name.value);

/** POSIX single-quote escaping. JSON quoting would leave a `$` in the path expandable by the shell. */
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Absolute node + absolute entry script: no dependency on `commit` being on PATH, and no risk of recursion. */
const shimSource = (alias: Alias): string =>
  ["#!/bin/sh", `exec ${shellQuote(process.execPath)} ${shellQuote(process.argv[1] ?? "")} ${alias.target} "$@"`, ""].join("\n");

const writeShim = (alias: Alias): Future<Error, void> =>
  Future.attemptP(async () => {
    const path = shimPath(alias.name);
    await mkdir(aliasBinDir(), { recursive: true });
    await writeFile(path, shimSource(alias), "utf-8");
    // writeFile's `mode` is ignored when the file already exists, so set it explicitly.
    await chmod(path, 0o755);
  });

const removeShim = (name: AliasName): Future<Error, void> => Future.attemptP(() => rm(shimPath(name), { force: true }));

/** Rewrites every shim from the registry, so stale node or entry-script paths heal on the next mutation. */
const reconcileShims = (aliases: readonly Alias[]): Future<Error, void> => Future.parallel(4, aliases.map(writeShim)).map(() => undefined);

const isExecutable = async (path: string): Promise<boolean> =>
  access(path, constants.X_OK).then(
    () => true,
    () => false
  );

/**
 * First executable named `name` on PATH outside our own bin dir.
 *
 * The bin dir is prepended to PATH, so an alias named after an existing binary would
 * shadow it — the create flow uses this to warn before that happens.
 */
const findConflictingBinary = (name: AliasName): Future<Error, Maybe<string>> =>
  Future.attemptP(async () => {
    const ownDir = aliasBinDir();
    const dirs = (process.env["PATH"] ?? "").split(delimiter).filter((dir) => dir && resolve(dir) !== ownDir);

    for (const dir of dirs) {
      const candidate = resolve(dir, name.value);
      if (await isExecutable(candidate)) return candidate;
    }

    return undefined;
  }).map(fromOptional);
