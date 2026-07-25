export { type Alias, type AliasTarget, type StoredAlias, ALIAS_TARGETS, AliasName, addAlias, describeTarget, findAlias, removeAlias, schema_StoredAlias };

import * as s from "@/libs/json/schema";

import { Failure, Success, type Result } from "@/libs/result";
import { fromOptional, Just, type Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";

const ALIAS_TARGETS = ["generate", "branch", "setup", "doctor", "model", "effort", "update"] as const;
type AliasTarget = (typeof ALIAS_TARGETS)[number];

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const RESERVED = ["commit", "commit-tools"];

/**
 * An alias name proven safe to use as a filename inside the alias bin dir.
 *
 * The constructor is private so the only way to obtain one is {@link AliasName.parse}.
 * Everything downstream — `shimPath`, `removeShim` — can treat it as proof that the
 * value has no path separators, no traversal segments, and is not a reserved name.
 */
class AliasName {
  // @ts-expect-error _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  private constructor(readonly value: string) {}

  static parse(raw: string): Result<string, AliasName> {
    const trimmed = raw.trim();
    // Lowercase so registry keys and shim paths share one identity on case-insensitive filesystems.
    const normalized = trimmed.toLowerCase();
    if (!NAME_PATTERN.test(normalized)) return Failure("Use 1-32 characters: letters, digits, '-' or '_', starting with a letter.");
    if (RESERVED.includes(normalized)) return Failure(`'${normalized}' is reserved by commit-tools.`);
    return Success(new AliasName(normalized));
  }
}

/** Trusted domain value: name is proven, target is a closed union. */
type Alias = { readonly name: AliasName; readonly target: AliasTarget };

/**
 * On-disk representation. Decoding stays total — no throwing inside a schema — and
 * `loadAliases` promotes a `StoredAlias` into an {@link Alias} via {@link AliasName.parse}.
 */
const schema_StoredAlias = s.object({ name: s.string, target: s.stringEnum([...ALIAS_TARGETS]) });
type StoredAlias = s.Infer<typeof schema_StoredAlias>;

const findAlias = (aliases: readonly Alias[], name: AliasName): Maybe<Alias> => fromOptional(aliases.find((a) => a.name.value === name.value));

/** Uniqueness is a property of the registry, not of a name — so it is checked here, not in `parse`. */
const addAlias = (aliases: readonly Alias[], alias: Alias): Result<string, readonly Alias[]> =>
  findAlias(aliases, alias.name) instanceof Just ? Failure(`Alias '${alias.name.value}' already exists. Delete it first.`) : Success([...aliases, alias]);

const removeAlias = (aliases: readonly Alias[], name: AliasName): Result<string, readonly Alias[]> =>
  findAlias(aliases, name) instanceof Just ? Success(aliases.filter((a) => a.name.value !== name.value)) : Failure(`No alias named '${name.value}'.`);

const describeTarget = (target: AliasTarget): string => {
  switch (target) {
    case "generate":
      return "Generate a commit message";
    case "branch":
      return "Suggest branch names and create one";
    case "setup":
      return "Configure authentication and conventions";
    case "doctor":
      return "Check installation and environment";
    case "model":
      return "Select a different AI model";
    case "effort":
      return "Adjust the reasoning effort";
    case "update":
      return "Install the latest version from npm";
    default:
      return absurd(target, "AliasTarget");
  }
};
