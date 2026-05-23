export { type GenerateRunMode, type MachineGit, defaultInteractiveMode, parseGenerateFlags, isAutomationFlag };

import { Failure, Success, type Result } from "@/libs/result";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { cliError } from "@/cli/json-io";

type MachineGit =
  | { type: "none" }
  | { type: "commit" }
  | { type: "commit_push"; readonly yes: boolean };

type GenerateRunMode =
  | { type: "interactive" }
  | {
      type: "json";
      readonly adjust: Maybe<string>;
      readonly dryRun: boolean;
      readonly git: MachineGit;
    };

type ParsedFlags = {
  json: boolean;
  commit: boolean;
  push: boolean;
  yes: boolean;
  dryRun: boolean;
  adjust: Maybe<string>;
};

const defaultInteractiveMode = (): GenerateRunMode => ({ type: "interactive" });

const isAutomationFlag = (arg: string): boolean =>
  arg === "--json" ||
  arg === "--commit" ||
  arg === "--push" ||
  arg === "--yes" ||
  arg === "--dry-run" ||
  arg === "--adjust";

const parseFlagToken = (argv: readonly string[], index: number): Result<Error, { key: string; nextIndex: number }> => {
  const arg = argv[index];
  if (arg === "--adjust") {
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      return Failure(cliError("INVALID_FLAGS", "--adjust requires a value"));
    }
    return Success({ key: `adjust:${value}`, nextIndex: index + 1 });
  }
  if (arg === undefined || !isAutomationFlag(arg)) {
    return Failure(cliError("INVALID_FLAGS", `Unknown flag: ${arg ?? ""}`));
  }
  return Success({ key: arg, nextIndex: index });
};

const collectFlags = (argv: readonly string[]): Result<Error, ParsedFlags> => {
  const flags: ParsedFlags = {
    json: false,
    commit: false,
    push: false,
    yes: false,
    dryRun: false,
    adjust: Nothing()
  };

  for (let i = 0; i < argv.length; i++) {
    const parsed = parseFlagToken(argv, i);
    if (parsed instanceof Failure) return Failure(parsed.error);

    const { key, nextIndex } = parsed.unwrap((e) => e.message);
    i = nextIndex;

    if (key.startsWith("adjust:")) {
      flags.adjust = Just(key.slice("adjust:".length));
      continue;
    }

    switch (key) {
      case "--json":
        flags.json = true;
        break;
      case "--commit":
        flags.commit = true;
        break;
      case "--push":
        flags.push = true;
        break;
      case "--yes":
        flags.yes = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      default:
        return Failure(cliError("INVALID_FLAGS", `Unknown flag: ${key}`));
    }
  }

  return Success(flags);
};

const validateFlags = (flags: ParsedFlags): Result<Error, void> => {
  const hasAutomation = flags.commit || flags.push || flags.yes || flags.dryRun || flags.adjust instanceof Just;
  if (hasAutomation && !flags.json) {
    return Failure(cliError("INVALID_FLAGS", "Automation flags require --json"));
  }
  if (flags.push && !flags.commit) {
    return Failure(cliError("INVALID_FLAGS", "--push requires --commit"));
  }
  if (flags.yes && !flags.push) {
    return Failure(cliError("INVALID_FLAGS", "--yes requires --push"));
  }
  return Success(undefined);
};

const toMachineGit = (flags: ParsedFlags): MachineGit =>
  flags.push ? { type: "commit_push", yes: flags.yes }
  : flags.commit ? { type: "commit" }
  : { type: "none" };

const parseGenerateFlags = (argv: readonly string[]): Result<Error, GenerateRunMode> => {
  const collected = collectFlags(argv);
  if (collected instanceof Failure) return Failure(collected.error);

  const flags = collected.unwrap((e) => e.message);
  const valid = validateFlags(flags);
  if (valid instanceof Failure) return Failure(valid.error);

  if (!flags.json) {
    return Success(defaultInteractiveMode());
  }

  return Success({
    type: "json",
    adjust: flags.adjust,
    dryRun: flags.dryRun,
    git: toMachineGit(flags)
  });
};
