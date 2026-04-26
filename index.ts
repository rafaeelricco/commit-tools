import { Commit } from "@/cli/commit";
import { Setup } from "@/cli/setup";
import { Doctor } from "@/cli/doctor";
import { ModelCommand } from "@/cli/model";
import { EffortCommand } from "@/cli/effort";
import { Update } from "@/cli/update";
import { type CliCommand, parseArgs, showHelp, showVersion } from "@/cli/parser";
import { Future } from "@/libs/future";
import { absurd } from "@/libs/types";
import { checkUpdate } from "@/cli/show-update-banner";

import color from "picocolors";

const NOTIFIER_COMMANDS = new Set<CliCommand["type"]>(["generate", "setup", "doctor", "model", "effort"]);

const main = () => {
  const args = process.argv.slice(2);

  const action = parseArgs(args).either(
    (err): Future<Error, void> => {
      console.error(color.red(err.message));
      return Future.reject(err);
    },
    (command): Future<Error, void> => {
      if (NOTIFIER_COMMANDS.has(command.type)) checkUpdate();

      switch (command.type) {
        case "generate":
          return Commit.create().chain((c) => c.run());
        case "setup":
          return Setup.create().chain((s) => s.run());
        case "doctor":
          return Doctor.create().run();
        case "model":
          return ModelCommand.create().chain((m) => m.run());
        case "effort":
          return EffortCommand.create().chain((e) => e.run());
        case "update":
          return Update.create().run();
        case "version":
          showVersion();
          return Future.resolve(undefined);
        case "help":
          showHelp();
          return Future.resolve(undefined);
        default:
          absurd(command, `Unhandled command type: ${command}`);
      }
    }
  );

  action.fork(
    (_) => process.exit(1),
    () => process.exit(0)
  );
};

main();
