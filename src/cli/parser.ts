export { type CliCommand, parseArgs, showHelp, showVersion };

import * as D from "@/libs/json/decoder";

import { Result } from "@/libs/result";
import { version as packageVersion } from "@/package.json";

type CliCommand =
  | { type: "generate" }
  | { type: "setup" }
  | { type: "doctor" }
  | { type: "model" }
  | { type: "effort" }
  | { type: "update" }
  | { type: "version" }
  | { type: "help" };

const cliCommandDecoder: D.Decoder<CliCommand> = D.array(D.string).chain((args) => {
  const cmd = args[0] || "-h";

  switch (cmd) {
    case "generate":
      return D.succeed({ type: "generate" });
    case "setup":
    case "login":
      return D.succeed({ type: "setup" });
    case "doctor":
      return D.succeed({ type: "doctor" });
    case "model":
      return D.succeed({ type: "model" });
    case "effort":
      return D.succeed({ type: "effort" });
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
  setup               Configure authentication and conventions
  login               Alias for setup (re-authenticate)
  doctor              Check installation and environment
  model               Select a different AI model
  effort              Adjust the reasoning effort for the current model
  update              Install the latest version from npm
  --version, -v       Show version
  --help, -h          Show help
  `);
};

const showVersion = (): void => console.log(packageVersion);
