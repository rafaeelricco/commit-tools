#!/usr/bin/env bun
import { Commit } from "@/app/commit";
import { Setup } from "@/app/setup";
import { Doctor } from "@/app/doctor";
import { configureDependencies } from "@/app/integrations";
import { showHelp, showVersion } from "@/app/ui";
import { Future } from "@/libs/future";

import color from "picocolors";

const main = () => {
  const deps = configureDependencies();
  const args = process.argv.slice(2);
  const command = args[0] || "generate";

  let action: Future<Error, void>;

  switch (command) {
    case "generate":
      action = Commit.create(deps).chain((flow) => flow.run());
      break;
    case "setup":
    case "login":
      action = Setup.create(deps).chain((s) => s.run());
      break;
    case "doctor":
      action = Doctor.create(deps).run();
      break;
    case "--version":
    case "-v":
      showVersion();
      return;
    case "--help":
    case "-h":
      showHelp();
      return;
    default:
      console.error(color.red(`Unknown command: ${command}`));
      showHelp();
      process.exit(1);
  }

  action.fork(
    (_) => process.exit(1),
    () => process.exit(0)
  );
};

main();
