import * as p from "@clack/prompts";

import { executeCommitFlow } from "@app/commands/commitFlow";
import { executeSetupFlow } from "@app/commands/setupFlow";
import { Future } from "@/future";
import { CONFIG_FILE } from "@app/config";
import { exists } from "fs/promises";

import color from "picocolors";
import Table from "cli-table3";

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0] || "generate";

  let flow: Future<Error, void>;

  switch (command) {
    case "generate":
      flow = executeCommitFlow();
      break;
    case "setup":
      flow = executeSetupFlow();
      break;
    case "doctor":
      flow = executeDoctorFlow();
      break;
    case "--version":
    case "-v":
      console.log("commit-gen 0.1.0 (bun)");
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

  flow.fork(
    err => {
      console.error(err)
      process.exit(1);
    },
    () => {
      process.exit(0);
    }
  );
};

const executeDoctorFlow = (): Future<Error, void> =>
  Future.attemptP(async () => {
    p.intro(color.bgBlue(color.black(" Commit Gen Doctor ")));
    
    const table = new Table({
      head: [color.bold("Check"), color.bold("Status"), color.bold("Details")],
      colWidths: [20, 15, 45],
    });

    // 1. Check Bun
    table.push(["Bun Runtime", color.green("OK"), Bun.version]);

    // 2. Check Platform
    table.push(["Platform", color.green("OK"), process.platform]);

    // 3. Check Configuration
    const configExists = await exists(CONFIG_FILE);
    if (!configExists) {
      table.push(["Config File", color.yellow("MISSING"), "~/.commit-gen/config.json"]);
    } else {
      table.push(["Config File", color.green("FOUND"), CONFIG_FILE]);
    }

    console.log(table.toString());

    if (!configExists) {
      p.log.warn(color.yellow("Run 'commit-gen setup' to create your configuration."));
    }

    p.outro("Doctor check complete!");
  });

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