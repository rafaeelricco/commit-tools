import { Commit } from "@/cli/commit";
import { Setup } from "@/cli/setup";
import { Doctor } from "@/cli/doctor";
import { ModelCommand } from "@/cli/model";
import { EffortCommand } from "@/cli/effort";
import { parseArgs, showHelp, showVersion } from "@/cli/parser";
import { Future } from "@/libs/future";

import color from "picocolors";

const main = () => {
  const args = process.argv.slice(2);

  const actionFuture = parseArgs(args).either(
    (err): Future<Error, void> => {
      console.error(color.red(err.message));
      showHelp();
      return Future.reject(err);
    },
    (command): Future<Error, void> => {
      switch (command.type) {
        case "generate":
          return Commit.create().chain((flow) => flow.run());
        case "setup":
          return Setup.create().chain((s) => s.run());
        case "doctor":
          return Doctor.create().run();
        case "model":
          return ModelCommand.create().chain((m) => m.run());
        case "effort":
          return EffortCommand.create().chain((e) => e.run());
        case "version":
          showVersion();
          return Future.resolve(undefined);
        case "help":
          showHelp();
          return Future.resolve(undefined);
        default: {
          const _exhaustiveCheck: never = command;
          return Future.reject(new Error(`Unhandled command: ${JSON.stringify(_exhaustiveCheck)}`));
        }
      }
    }
  );

  actionFuture.fork(
    (_) => process.exit(1),
    () => process.exit(0)
  );
};

main();
