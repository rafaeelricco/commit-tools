export { type CliCommand, parseArgs };

import * as D from "@/libs/json/decoder";

import { Result } from "@/libs/result";

type CliCommand =
  | { type: "generate" }
  | { type: "setup" }
  | { type: "doctor" }
  | { type: "version" }
  | { type: "help" };

const cliCommandDecoder: D.Decoder<CliCommand> = D.array(D.string).chain((args) => {
  const cmd = args[0] || "generate";

  switch (cmd) {
    case "generate":
      return D.succeed({ type: "generate" as const });
    case "setup":
    case "login":
      return D.succeed({ type: "setup" as const });
    case "doctor":
      return D.succeed({ type: "doctor" as const });
    case "--version":
    case "-v":
      return D.succeed({ type: "version" as const });
    case "--help":
    case "-h":
      return D.succeed({ type: "help" as const });
    default:
      return D.fail(`Unknown command: ${cmd}`);
  }
});

const parseArgs = (args: string[]): Result<Error, CliCommand> =>
  D.decode(args, cliCommandDecoder).mapFailure((err) => new Error(err));
