export { aliasesFile, loadAliases, saveAliases };

import * as s from "@/libs/json/schema";

import { Future } from "@/libs/future";
import { Failure, Success, traverse_, type Result } from "@/libs/result";
import { AliasName, schema_StoredAlias, type Alias, type StoredAlias } from "@/domain/alias/alias";
import { configDir } from "@/infra/storage/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const AliasFile = s.object({ aliases: s.array(schema_StoredAlias) });

const aliasesFile = (): string => resolve(configDir(), "aliases.json");

const isMissingFile = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/** Promote stored rows into trusted values: every name is proven and duplicates are rejected. */
const toDomain = (stored: readonly StoredAlias[]): Result<Error, readonly Alias[]> =>
  traverse_([...stored], (row) =>
    AliasName.parse(row.name)
      .mapFailure((msg) => new Error(`Invalid alias name '${row.name}' in ${aliasesFile()}: ${msg}`))
      .map((name): Alias => ({ name, target: row.target }))
  ).chain((aliases) =>
    new Set(aliases.map((a) => a.name.value)).size === aliases.length ?
      Success<Error, readonly Alias[]>(aliases)
    : Failure<Error, readonly Alias[]>(new Error(`Duplicate alias names in ${aliasesFile()}. Fix the file or delete it to start over.`))
  );

const parseAliasesJson = (raw: string): Result<Error, unknown> => {
  try {
    return Success(JSON.parse(raw));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return Failure(new Error(`Aliases file is not valid JSON (${aliasesFile()}): ${detail}. Fix the file or delete it to start over.`));
  }
};

const parseAliasFile = (raw: string): Result<Error, readonly Alias[]> =>
  parseAliasesJson(raw)
    .chain((json) => s.decode(AliasFile, json).mapFailure((err) => new Error(`Invalid aliases file (${aliasesFile()}): ${err}`)))
    .chain((file) => toDomain(file.aliases));

/** A missing file is the empty registry; a corrupt one rejects so aliases are never silently dropped. */
const loadAliases = (): Future<Error, readonly Alias[]> =>
  Future.attemptP(async () => {
    try {
      return await readFile(aliasesFile(), "utf-8");
    } catch (err) {
      if (isMissingFile(err)) return undefined;
      throw err;
    }
  }).chain((raw) =>
    raw === undefined ?
      Future.resolve<Error, readonly Alias[]>([])
    : parseAliasFile(raw).either(
        (err) => Future.reject<Error, readonly Alias[]>(err),
        (aliases) => Future.resolve<Error, readonly Alias[]>(aliases)
      )
  );

const saveAliases = (aliases: readonly Alias[]): Future<Error, void> =>
  Future.attemptP(async () => {
    const stored = aliases.map((a): StoredAlias => ({ name: a.name.value, target: a.target }));
    await mkdir(configDir(), { recursive: true });
    await writeFile(aliasesFile(), JSON.stringify(s.encode(AliasFile, { aliases: stored }), null, 2), "utf-8");
  });
