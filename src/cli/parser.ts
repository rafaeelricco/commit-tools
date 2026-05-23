export { type CliCommand, parseArgs, showHelp, showVersion };

import { defaultInteractiveMode, isAutomationFlag, parseGenerateFlags, type GenerateRunMode } from "@/cli/generate-flags";
import { cliError } from "@/cli/json-io";
import { Failure, Success, type Result } from "@/libs/result";
import { version as packageVersion } from "@/package.json";

type CliCommand =
  | { type: "generate"; mode: GenerateRunMode }
  | { type: "setup" }
  | { type: "doctor"; json: boolean }
  | { type: "model" }
  | { type: "effort" }
  | { type: "update" }
  | { type: "version" }
  | { type: "help" };

const GLOBAL_COMMANDS = new Set(["--version", "-v", "--help", "-h", "setup", "login", "doctor", "model", "effort", "update", "generate"]);

const parseDoctorFlags = (argv: readonly string[]): Result<Error, boolean> => {
  if (argv.length === 0) return Success(false);
  if (argv.length === 1 && argv[0] === "--json") return Success(true);
  return Failure(cliError("INVALID_FLAGS", `Unknown flag for doctor: ${argv[0]}`));
};

const parseGenerateCommand = (argv: readonly string[]): Result<Error, CliCommand> =>
  parseGenerateFlags(argv).map((mode) => ({ type: "generate", mode }));

const parseArgs = (args: readonly string[]): Result<Error, CliCommand> => {
  if (args.length === 0) {
    return Success({ type: "generate", mode: defaultInteractiveMode() });
  }

  const first = args[0]!;

  if (first === "--version" || first === "-v") return Success({ type: "version" });
  if (first === "--help" || first === "-h") return Success({ type: "help" });

  if (isAutomationFlag(first)) {
    return parseGenerateCommand(args);
  }

  if (!GLOBAL_COMMANDS.has(first)) {
    return Failure(new Error(`Unknown command: ${first}`));
  }

  const rest = args.slice(1);

  switch (first) {
    case "generate":
      return parseGenerateCommand(rest);
    case "setup":
    case "login":
      return Success({ type: "setup" });
    case "doctor":
      return parseDoctorFlags(rest).map((json) => ({ type: "doctor", json }));
    case "model":
      return Success({ type: "model" });
    case "effort":
      return Success({ type: "effort" });
    case "update":
      return Success({ type: "update" });
    default: {
      const _exhaustive: never = first as never;
      return Failure(new Error(`Unknown command: ${_exhaustive}`));
    }
  }
};

const showHelp = (): void => {
  console.log(`
Usage: commit [command] [flags]

Commands:
  generate (default)  Generate a commit message (interactive)
  setup               Configure authentication and conventions
  login               Alias for setup
  doctor              Check installation and environment
  model               Select a different AI model
  effort              Adjust reasoning effort
  update              Install the latest version
  --version, -v       Show version
  --help, -h          Show help

Generate flags (require --json except --json itself):
  --json              Machine output (JSON on stdout, no prompts)
  --adjust <text>     Refine the generated message
  --dry-run           Generate only; do not commit or push
  --commit            Commit with the generated message
  --push              Push after commit (requires --commit)
  --yes               Publish branch or force-with-lease without confirm (requires --push)

Agent examples:
  commit generate --json
  commit generate --json --commit
  commit generate --json --commit --push
  commit --json --adjust "shorter subject" --dry-run
  commit doctor --json
  `);
};

const showVersion = (): void => console.log(packageVersion);
