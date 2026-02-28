export { Doctor };

import { Future } from "@/libs/future";
import { CONFIG_FILE, loadConfig } from "@/app/storage";
import { type AuthMethod, type ProviderConfig } from "@/app/services/config";
import { exists } from "fs/promises";
import { environment } from "@/app/integrations";

import color from "picocolors";
import Table from "cli-table3";

type CheckRow = [string, string, string];

class Doctor {
  private constructor() {}

  static create(): Doctor {
    return new Doctor();
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
    const clientId = environment.GOOGLE_CLIENT_ID;
    const row: CheckRow = ["OAuth Credentials", color.green("Configured"), `Client ID: ${clientId.slice(0, 12)}...`];
    return Future.resolve(row);
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

          rows.push(["Auth Method", color.green(authMethodLabel(authMethod)), authMethodDescription(ai)]);

          if (ai.auth_method.type === "google_oauth" || ai.auth_method.type === "openai_oauth") {
            const now = Date.now();
            const expiryDate = ai.auth_method.content.expiry_date; // For API Key we don't have this, that's why we have this `if (...) {}` block
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

function authMethodLabel(authMethod: AuthMethod): string {
  switch (authMethod) {
    case "google_oauth":
    case "openai_oauth":
      return "OAuth";
    case "api_key":
      return "API Key";
    default:
      return "This should never happen. Please run 'commit-tools setup' to create a new configuration.";
  }
}

function authMethodDescription(ai: ProviderConfig): string {
  switch (ai.auth_method.type) {
    case "google_oauth":
      return "Google OAuth 2.0";
    case "openai_oauth":
      return "OpenAI Codex OAuth";
    case "api_key":
      return ai.provider === "openai" ? "OpenAI API Key" : "Google AI Studio API Key";
    default:
      return "This should never happen. Please run 'commit-tools setup' to create a new configuration.";
  }
}
