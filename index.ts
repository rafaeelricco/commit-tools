#!/usr/bin/env bun
import { executeCommitFlow } from "@app/commit/generateCommit";
import { executeSetupFlow } from "@app/setup/setupFlow";
import { executeDoctorFlow } from "@app/doctor/doctorFlow";
import { configureDependencies } from "@infra/config/integrations";
import { Future } from "@/future";

import color from "picocolors";

const main = () => {
  const { oauth } = configureDependencies();
  const args = process.argv.slice(2);
  const command = args[0] || "generate";

  let action: Future<Error, void>;

  switch (command) {
    case "generate":
      action = executeCommitFlow({ oauth });
      break;
    case "setup":
    case "login":
      action = executeSetupFlow({ oauth });
      break;
    case "doctor":
      action = executeDoctorFlow({ oauth });
      break;
    case "--version":
    case "-v": {
      const start = performance.now();
      console.log("commit-tools 0.1.0 (bun)");
      const end = performance.now();
      const diff = end - start;
      console.log(`Done in ${diff.toLocaleString()}ms`);
      return;
    }
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
Usage: commit-tools [command]

Commands:
  generate (default)  Generate a commit message
  setup               Configure authentication and conventions
  login               Alias for setup (re-authenticate)
  doctor              Check installation and environment
  --version, -v       Show version
  --help, -h          Show help
  `);
};

main();
