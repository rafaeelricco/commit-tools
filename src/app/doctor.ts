export { Doctor };

import { Future } from "@/libs/future";
import { CONFIG_FILE, loadConfig } from "@/app/storage";
import { exists } from "fs/promises";
import { Dependencies } from "@/app/integrations";

import color from "picocolors";
import Table from "cli-table3";

type CheckRow = [string, string, string];

class Doctor {
  private constructor(private readonly deps: Dependencies) {}

  static create(deps: Dependencies): Doctor {
    return new Doctor(deps);
  }

  run(): Future<Error, void> {
    return this.checkOAuthCredentials().chain((oauthRow) =>
      this.checkConfig().map((configRows) => {
        const rows: CheckRow[] = [this.checkRuntime(), this.checkPlatform(), oauthRow, ...configRows];
        this.renderTable(rows);
      })
    );
  }

  private checkRuntime(): CheckRow {
    return ["Runtime", color.green("Bun"), Bun.version];
  }

  private checkPlatform(): CheckRow {
    return ["Platform", color.green("macOS"), process.platform];
  }

  private checkOAuthCredentials(): Future<Error, CheckRow> {
    return this.deps
      .resolveOAuth()
      .map(
        (ok): CheckRow => ["OAuth Credentials", color.green("Configured"), `Client ID: ${ok.clientId.slice(0, 12)}...`]
      )
      .chainRej(
        (): Future<Error, CheckRow> =>
          Future.resolve([
            "OAuth Credentials",
            color.yellow("Missing"),
            "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set"
          ])
      );
  }

  private checkConfig(): Future<Error, CheckRow[]> {
    return Future.attemptP(() => exists(CONFIG_FILE)).chain((configExists) => {
      const row: CheckRow = [
        "Configuration",
        configExists ? color.green("Found") : color.yellow("Missing"),
        configExists ? CONFIG_FILE : "Run 'commit-tools setup' to create"
      ];

      if (!configExists) {
        return Future.resolve<Error, CheckRow[]>([row]);
      }

      return loadConfig()
        .map((config) => {
          const rows: CheckRow[] = [row];
          const ai = config.ai;

          rows.push(["Provider", color.green(ai.provider), `Model: ${ai.model}`]);

          const authMethod = ai.auth_method.type;

          rows.push([
            "Auth Method",
            color.green(authMethod === "oauth" ? "OAuth" : "API Key"),
            authMethod === "oauth" ? "Google OAuth 2.0" : "Google AI Studio API Key"
          ]);

          if (ai.auth_method.type === "oauth") {
            const now = Date.now();
            const expiryDate = ai.auth_method.content.expiry_date;
            const isExpired = expiryDate <= now;
            const expiryStr = new Date(expiryDate).toLocaleString();

            rows.push([
              "Token Status",
              isExpired ? color.yellow("Expired") : color.green("Valid"),
              isExpired ? `Expired at ${expiryStr} (will auto-refresh)` : `Expires at ${expiryStr}`
            ]);
          }

          return rows;
        })
        .chainRej((): Future<Error, CheckRow[]> => Future.resolve([row]));
    });
  }

  private renderTable(rows: CheckRow[]): void {
    const table = new Table({
      head: [color.cyan("Check"), color.cyan("Status"), color.cyan("Info")],
      colWidths: [20, 15, 40]
    });

    for (const row of rows) {
      table.push(row);
    }

    process.stdout.write("\n" + table.toString() + "\n\n");

    const hasConfig = rows.some(([check, status]) => check === "Configuration" && status.includes("Found"));
    if (!hasConfig) {
      process.stdout.write(color.yellow("! Please run 'commit-tools setup' to configure your API key.\n\n"));
    } else {
      process.stdout.write(color.green("System is ready to generate commits!\n\n"));
    }
  }
}
