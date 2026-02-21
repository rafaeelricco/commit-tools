#!/usr/bin/env bun
import { Commit } from "@/app/commit";
import { Setup } from "@/app/setup";
import { Doctor } from "@/app/doctor";
import { configureDependencies } from "@/app/integrations";
import { showHelp, showVersion } from "@/app/ui";
import { parseArgs } from "@/app/cli";
import { Future } from "@/libs/future";

import color from "picocolors";

const main = () => {
  const deps = configureDependencies();
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
          return Commit.create(deps).chain((flow) => flow.run());
        case "setup":
          return Setup.create(deps).chain((s) => s.run());
        case "doctor":
          return Doctor.create(deps).run();
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
