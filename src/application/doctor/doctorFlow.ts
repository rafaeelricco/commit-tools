import { Future } from "@/future";
import { CONFIG_FILE } from "@infra/config/storage";
import { exists } from "fs/promises";
import color from "picocolors";
import Table from "cli-table3";

export const executeDoctorFlow = (): Future<Error, void> =>
  Future.attemptP(async () => {
    const table = new Table({
      head: [color.cyan("Check"), color.cyan("Status"), color.cyan("Info")],
      colWidths: [20, 15, 40],
    });

    // Runtime Check
    table.push(["Runtime", color.green("Bun"), Bun.version]);

    // Platform Check
    table.push(["Platform", color.green("macOS"), process.platform]);

    // Config Check
    const configExists = await exists(CONFIG_FILE);
    table.push([
      "Configuration",
      configExists ? color.green("Found") : color.yellow("Missing"),
      configExists ? CONFIG_FILE : "Run 'commit-gen setup' to create",
    ]);

    process.stdout.write("\n" + table.toString() + "\n\n");

    if (!configExists) {
      process.stdout.write(color.yellow("! Please run 'commit-gen setup' to configure your API key.\n\n"));
    } else {
      process.stdout.write(color.green("✓ System is ready to generate commits!\n\n"));
    }
  });
