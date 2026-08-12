export { type AliasAction, type CliCommand, parseArgs, showHelp, showVersion };

import * as D from "@/libs/json/decoder";

import { ALIAS_TARGETS, type AliasTarget } from "@/domain/alias/alias";
import { Result } from "@/libs/result";
import { version as packageVersion } from "@/package.json";

type AliasAction = { type: "hub" } | { type: "list" } | { type: "add"; name: string; target: AliasTarget } | { type: "remove"; name: string };

type CliCommand =
  | { type: "generate" }
  | { type: "split" }
  | { type: "setup" }
  | { type: "doctor" }
  | { type: "model" }
  | { type: "effort" }
  | { type: "branch" }
  | { type: "alias"; action: AliasAction }
  | { type: "update" }
  | { type: "version" }
  | { type: "help" };

const isAliasTarget = (value: string): value is AliasTarget => (ALIAS_TARGETS as readonly string[]).includes(value);

// The name stays a raw string here; AliasCommand turns it into an AliasName so both
// the interactive and the scripted entry points report the same validation message.
const parseAliasAction = (args: string[]): D.Decoder<CliCommand> => {
  const [sub, name, target] = [args[1], args[2], args[3]];

  switch (sub) {
    case undefined:
      return D.succeed({ type: "alias", action: { type: "hub" } });
    case "list":
    case "ls":
      return D.succeed({ type: "alias", action: { type: "list" } });
    case "add":
    case "new":
      if (!name || !target) return D.fail(`Usage: commit alias add <name> <target>. Targets: ${ALIAS_TARGETS.join(", ")}`);
      if (!isAliasTarget(target)) return D.fail(`Alias target must be one of: ${ALIAS_TARGETS.join(", ")}`);
      return D.succeed({ type: "alias", action: { type: "add", name, target } });
    case "remove":
    case "rm":
      if (!name) return D.fail("Usage: commit alias remove <name>");
      return D.succeed({ type: "alias", action: { type: "remove", name } });
    default:
      return D.fail(`Unknown alias subcommand: ${sub}`);
  }
};

const cliCommandDecoder: D.Decoder<CliCommand> = D.array(D.string).chain((args) => {
  const cmd = args[0] || "generate";

  switch (cmd) {
    case "generate":
      return D.succeed({ type: "generate" });
    case "split":
      return D.succeed({ type: "split" });
    case "setup":
    case "login":
      return D.succeed({ type: "setup" });
    case "doctor":
      return D.succeed({ type: "doctor" });
    case "model":
      return D.succeed({ type: "model" });
    case "effort":
      return D.succeed({ type: "effort" });
    case "branch":
    case "new-branch":
      return D.succeed({ type: "branch" });
    case "alias":
    case "aliases":
      return parseAliasAction(args);
    case "update":
      return D.succeed({ type: "update" });
    case "--version":
    case "-v":
      return D.succeed({ type: "version" });
    case "--help":
    case "-h":
      return D.succeed({ type: "help" });
    default:
      return D.fail(`Unknown command: ${cmd}`);
  }
});

const parseArgs = (args: string[]): Result<Error, CliCommand> => D.decode(args, cliCommandDecoder).mapFailure((err) => new Error(err));

const showHelp = (): void => {
  console.log(`
Usage: commit-tools [command]

Commands:
  generate (default)  Generate a commit message
  split               Force a multi-commit plan from staged changes
  branch              Suggest branch names from local changes and create one
  new-branch          Alias for branch
  setup               Configure authentication and conventions
  login               Alias for setup (re-authenticate)
  doctor              Check installation and environment
  model               Select a different AI model
  effort              Adjust the reasoning effort for the current model
  alias               Manage extra CLI names (list, add <name> <target>, remove <name>)
  update              Install the latest version from npm
  --version, -v       Show version
  --help, -h          Show help
  `);
};

const showVersion = (): void => console.log(packageVersion);
