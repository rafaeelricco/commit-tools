export { executeDoctorFlow };

import { Future } from "@/libs/future";
import { CONFIG_FILE, loadConfig } from "@/app/storage";
import { exists } from "fs/promises";
import { type Dependencies } from "@/app/integrations";

import color from "picocolors";
import Table from "cli-table3";

const executeDoctorFlow = (deps: Dependencies): Future<Error, void> =>
  Future.attemptP(async () => {
    const table = new Table({
      head: [color.cyan("Check"), color.cyan("Status"), color.cyan("Info")],
      colWidths: [20, 15, 40],
    });

    table.push(["Runtime", color.green("Bun"), Bun.version]);

    table.push(["Platform", color.green("macOS"), process.platform]);

    const oauthResult = await deps.resolveOAuth().promiseR();
    const [oauthStatus, oauthInfo] = oauthResult.either(
      () => [color.yellow("Missing"), "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set"],
      ok => [color.green("Configured"), `Client ID: ${ok.clientId.slice(0, 12)}...`]
    );

    table.push(["OAuth Credentials", oauthStatus, oauthInfo]);

    const configExists = await exists(CONFIG_FILE);
    table.push([
      "Configuration",
      configExists ? color.green("Found") : color.yellow("Missing"),
      configExists ? CONFIG_FILE : "Run 'commit-tools setup' to create",
    ]);

    if (configExists) {
      const configResult = await loadConfig().promiseR();

      configResult.either(
        () => {},
        config => {
          const authMethod = config.auth_method.type;

          table.push([
            "Auth Method",
            color.green(authMethod === "oauth" ? "OAuth" : "API Key"),
            authMethod === "oauth"
              ? "Google OAuth 2.0"
              : "Google AI Studio API Key",
          ]);

          if (config.auth_method.type === "oauth") {
            const now = Date.now();
            const expiryDate = config.auth_method.content.expiry_date;
            const isExpired = expiryDate <= now;
            const expiryStr = new Date(expiryDate).toLocaleString();

            table.push([
              "Token Status",
              isExpired ? color.yellow("Expired") : color.green("Valid"),
              isExpired
                ? `Expired at ${expiryStr} (will auto-refresh)`
                : `Expires at ${expiryStr}`,
            ]);
          }
        },
      );
    }

    process.stdout.write("\n" + table.toString() + "\n\n");

    if (!configExists) {
      process.stdout.write(color.yellow("! Please run 'commit-tools setup' to configure your API key.\n\n"));
    } else {
      process.stdout.write(color.green("System is ready to generate commits!\n\n"));
    }
  });
