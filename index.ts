#!/usr/bin/env bun
import { executeCommitFlow } from "@app/commit/generateCommit";
import { executeSetupFlow } from "@app/setup/setupFlow";
import { executeDoctorFlow } from "@app/doctor/doctorFlow";
import { Future } from "@/future";

import color from "picocolors";

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0] || "generate";

  let action: Future<Error, void>;

  switch (command) {
    case "generate":
      action = executeCommitFlow();
      break;
    case "setup":
      action = executeSetupFlow();
      break;
    case "doctor":
      action = executeDoctorFlow();
      break;
    case "--version":
    case "-v":
      console.log("commit-gen 0.1.1 (bun)");
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
    _ => process.exit(1),
    () => process.exit(0)
  );
};

const showHelp = () => {
  console.log(`
Usage: commit-gen [command]

Commands:
  generate (default)  Generate a commit message
  setup               Configure API keys and conventions
  doctor              Check installation and environment
  --version, -v       Show version
  --help, -h          Show help
  `);
};

main();