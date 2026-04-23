export { Doctor };

import * as pr from "@/infra/github/pr";
import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { CONFIG_FILE, loadConfig } from "@/infra/storage/config";
import { type AuthMethod, type ProviderConfig } from "@/domain/config/config";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";
import { access } from "node:fs/promises";
import { environment } from "@/infra/env";

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
      this.checkConfig().chain((configRows) =>
        this.checkGitContext().map((gitRows) => {
          const rows: CheckRow[] = [this.checkRuntime(), this.checkPlatform(), oauthRow, ...configRows, ...gitRows];
          this.renderTable(rows);
        })
      )
    );
  }

  private checkRuntime(): CheckRow {
    return ["Runtime", color.green("Node.js"), process.version];
  }

  private checkPlatform(): CheckRow {
    const label =
      process.platform === "darwin" ? "macOS"
      : process.platform === "win32" ? "Windows"
      : process.platform === "linux" ? "Linux"
      : process.platform;
    return ["Platform", color.green(label), process.platform];
  }

  private checkOAuthCredentials(): Future<Error, CheckRow> {
    const clientId = environment.GOOGLE_CLIENT_ID;
    const row: CheckRow = ["OAuth Credentials", color.green("Configured"), `Client ID: ${clientId.slice(0, 12)}...`];
    return Future.resolve(row);
  }

  private checkConfig(): Future<Error, CheckRow[]> {
    return Future.attemptP(() =>
      access(CONFIG_FILE)
        .then(() => true)
        .catch(() => false)
    ).chain((configExists) => {
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

          rows.push(["Provider", color.green(ai.provider), renderModelInfo(ai)]);

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

  private checkGitContext(): Future<Error, CheckRow[]> {
    return repo
      .checkIsGitRepo()
      .chain((): Future<Error, CheckRow[]> => this.collectGitRows())
      .chainRej(
        (): Future<Error, CheckRow[]> =>
          Future.resolve([["Git Repository", color.yellow("Outside"), "Not a git repository"]])
      );
  }

  private collectGitRows(): Future<Error, CheckRow[]> {
    // TODO: We definetly need to remove these functions; If we need to do this complex thing, maybe the function signature needs to be changed to something more simple
    const optional = <T>(f: Future<Error, T>): Future<Error, Maybe<T>> =>
      f.map((v): Maybe<T> => Just(v)).chainRej((): Future<Error, Maybe<T>> => Future.resolve(Nothing<T>()));

    // TODO: We definetly need to remove these functions; If we need to do this complex thing, maybe the function signature needs to be changed to something more simple
    const recoverMaybe = <T>(f: Future<Error, Maybe<T>>): Future<Error, Maybe<T>> =>
      f.chainRej((): Future<Error, Maybe<T>> => Future.resolve(Nothing<T>()));

    return Future.concurrently<Error, { branch: Maybe<string>; base: Maybe<string>; pr: pr.PrLookup }>({
      branch: optional(repo.getCurrentBranch()),
      base: recoverMaybe(repo.getBaseBranch()),
      pr: pr.getOpenPullRequest()
    }).map(({ branch, base, pr: prLookup }): CheckRow[] => [
      renderBranchRow(branch),
      renderBaseRow(base),
      renderPrRow(prLookup)
    ]);
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

function renderBranchRow(branch: Maybe<string>): CheckRow {
  return branch instanceof Just ?
      ["Branch", color.green("Current"), branch.value]
    : ["Branch", color.yellow("Unknown"), "Could not read current branch"];
}

function renderBaseRow(base: Maybe<string>): CheckRow {
  return base instanceof Just ?
      ["Base", color.green("Detected"), base.value]
    : ["Base", color.yellow("Unknown"), "Could not resolve base branch"];
}

function renderPrRow(lookup: pr.PrLookup): CheckRow {
  switch (lookup.type) {
    case "found":
      return ["Pull Request", color.green("Open"), `#${lookup.pr.number} ${lookup.pr.url}`];
    case "not-found":
      return ["Pull Request", color.yellow("None"), "No open PR for this branch"];
    case "unauthenticated":
      return ["Pull Request", color.yellow("Auth"), "Run 'gh auth login' to enable PR lookup"];
    case "unavailable":
      return ["Pull Request", color.gray("Skipped"), "gh not installed or remote is not GitHub"];
    default:
      return absurd(lookup, "PrLookup");
  }
}

function renderModelInfo(ai: ProviderConfig): string {
  const base = `${ai.model}`;
  return ai.effort instanceof Just ? `${base} (${ai.effort.value} effort)` : base;
}

function authMethodLabel(authMethod: AuthMethod): string {
  switch (authMethod) {
    case "google_oauth":
    case "openai_oauth":
      return "OAuth";
    case "anthropic_setup_token":
      return "Setup Token";
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
    case "anthropic_setup_token":
      return "Claude Setup-Token";
    case "api_key":
      switch (ai.provider) {
        case "openai":
          return "OpenAI API Key";
        case "anthropic":
          return "Anthropic API Key";
        case "gemini":
          return "Google AI Studio API Key";
      }
    default:
      return "This should never happen. Please run 'commit-tools setup' to create a new configuration.";
  }
}
