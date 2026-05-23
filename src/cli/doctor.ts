export { Doctor };

import * as pr from "@/infra/github/pr";
import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { configFile, loadConfig } from "@/infra/storage/config";
import { type AuthMethod, type ProviderConfig } from "@/domain/config/config";
import { Just, type Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";
import { access } from "node:fs/promises";
import { environment } from "@/infra/env";
import { name as packageName, version as packageVersion } from "@/package.json";
import { writeDoctorSuccess, type DoctorSuccess } from "@/cli/json-io";

import color from "picocolors";
import Table from "cli-table3";

type CheckLevel = "ok" | "warn" | "error" | "skip";

type Check = {
  readonly name: string;
  readonly status: string;
  readonly level: CheckLevel;
  readonly info: string;
};

type DoctorRunOptions = {
  readonly json: boolean;
};

class Doctor {
  private constructor() {}

  static create(): Doctor {
    return new Doctor();
  }

  run(options: DoctorRunOptions): Future<Error, void> {
    const start = performance.now();
    return this.checkOAuthCredentials().chain((oauthCheck) =>
      this.checkConfig().chain((configChecks) =>
        this.checkGitContext().map((gitChecks) => {
          const checks: Check[] = [
            { name: "CLI Version", status: "ok", level: "ok", info: `${packageName} ${packageVersion}` },
            this.checkRuntime(),
            this.checkPlatform(),
            oauthCheck,
            ...configChecks,
            ...gitChecks
          ];
          const elapsedMs = performance.now() - start;

          if (options.json) {
            writeDoctorSuccess(toDoctorSuccess(checks, elapsedMs));
            return;
          }

          this.renderTable(checks, elapsedMs);
        })
      )
    );
  }

  private checkRuntime(): Check {
    return { name: "Runtime", status: "ok", level: "ok", info: `Node.js ${process.version}` };
  }

  private checkPlatform(): Check {
    const label =
      process.platform === "darwin" ? "macOS"
      : process.platform === "win32" ? "Windows"
      : process.platform === "linux" ? "Linux"
      : process.platform;
    return { name: "Platform", status: "ok", level: "ok", info: label };
  }

  private checkOAuthCredentials(): Future<Error, Check> {
    const clientId = environment.GOOGLE_CLIENT_ID;
    return Future.resolve({
      name: "OAuth Credentials",
      status: "ok",
      level: "ok",
      info: `Client ID: ${clientId.slice(0, 12)}...`
    });
  }

  private checkConfig(): Future<Error, Check[]> {
    return Future.attemptP(() =>
      access(configFile())
        .then(() => true)
        .catch(() => false)
    ).chain((configExists) => {
      const missingCheck: Check = {
        name: "Configuration",
        status: "missing",
        level: "warn",
        info: "Run 'commit setup' to create"
      };

      if (!configExists) {
        return Future.resolve<Error, Check[]>([missingCheck]);
      }

      const foundCheck: Check = {
        name: "Configuration",
        status: "found",
        level: "ok",
        info: configFile()
      };

      return loadConfig()
        .map((config) => {
          const rows: Check[] = [foundCheck];
          const ai = config.ai;

          rows.push({
            name: "Provider",
            status: "ok",
            level: "ok",
            info: renderModelInfo(ai)
          });

          rows.push({
            name: "Auth Method",
            status: "ok",
            level: "ok",
            info: `${authMethodLabel(ai.auth_method.type)} — ${authMethodDescription(ai)}`
          });

          if (ai.auth_method.type === "google_oauth" || ai.auth_method.type === "openai_oauth") {
            const now = Date.now();
            const expiryDate = ai.auth_method.content.expiry_date;
            const isExpired = expiryDate <= now;
            rows.push({
              name: "Token Status",
              status: isExpired ? "expired" : "valid",
              level: isExpired ? "warn" : "ok",
              info:
                isExpired ?
                  `Expired at ${new Date(expiryDate).toISOString()}`
                : `Expires at ${new Date(expiryDate).toISOString()}`
            });
          }

          return rows;
        })
        .chainRej((): Future<Error, Check[]> => Future.resolve([foundCheck]));
    });
  }

  private checkGitContext(): Future<Error, Check[]> {
    return repo
      .checkIsGitRepo()
      .chain((): Future<Error, Check[]> => this.collectGitChecks())
      .chainRej((): Future<Error, Check[]> =>
        Future.resolve([
          {
            name: "Git Repository",
            status: "outside",
            level: "warn",
            info: "Not a git repository"
          }
        ])
      );
  }

  private collectGitChecks(): Future<Error, Check[]> {
    return Future.concurrently<Error, { branch: Maybe<string>; base: Maybe<string>; pr: pr.PrLookup }>({
      branch: repo.findCurrentBranch(),
      base: repo.findBaseBranch(),
      pr: pr.getOpenPullRequest()
    }).map(({ branch, base, pr: prLookup }): Check[] => [renderBranchCheck(branch), renderBaseCheck(base), renderPrCheck(prLookup)]);
  }

  private renderTable(checks: Check[], elapsedMs: number): void {
    const table = new Table({
      head: [color.cyan("Check"), color.cyan("Status"), color.cyan("Info")],
      colWidths: [20, 15, 40]
    });

    for (const check of checks) {
      table.push([check.name, colorizeStatus(check), check.info]);
    }

    process.stdout.write("\n" + table.toString() + "\n\n");

    const ready = checks.some((c) => c.name === "Configuration" && c.status === "found");
    if (!ready) {
      process.stdout.write(color.yellow("! Please run 'commit setup' to configure your API key.\n\n"));
    } else {
      process.stdout.write(color.green(`System is ready to generate commits! Done in ${(elapsedMs / 1000).toFixed(2)}s`));
    }
  }
}

const toDoctorSuccess = (checks: Check[], elapsedMs: number): DoctorSuccess => ({
  ok: true,
  command: "doctor",
  checks: checks.map((c) => ({ name: c.name, status: c.status, level: c.level, info: c.info })),
  ready: checks.some((c) => c.name === "Configuration" && c.status === "found"),
  elapsedMs
});

const colorizeStatus = (check: Check): string => {
  switch (check.level) {
    case "ok":
      return color.green(check.status);
    case "warn":
      return color.yellow(check.status);
    case "error":
      return color.red(check.status);
    case "skip":
      return color.gray(check.status);
    default: {
      const _exhaustive: never = check.level;
      return _exhaustive;
    }
  }
};

function renderBranchCheck(branch: Maybe<string>): Check {
  return branch instanceof Just ?
      { name: "Branch", status: "current", level: "ok", info: branch.value }
    : { name: "Branch", status: "unknown", level: "warn", info: "Could not read current branch" };
}

function renderBaseCheck(base: Maybe<string>): Check {
  return base instanceof Just ?
      { name: "Base", status: "detected", level: "ok", info: base.value }
    : { name: "Base", status: "unknown", level: "warn", info: "Could not resolve base branch" };
}

function renderPrCheck(lookup: pr.PrLookup): Check {
  switch (lookup.type) {
    case "found":
      return { name: "Pull Request", status: "open", level: "ok", info: `#${lookup.pr.number} ${lookup.pr.url}` };
    case "not-found":
      return { name: "Pull Request", status: "none", level: "warn", info: "No open PR for this branch" };
    case "unauthenticated":
      return { name: "Pull Request", status: "auth", level: "warn", info: "Run 'gh auth login' to enable PR lookup" };
    case "unavailable":
      return { name: "Pull Request", status: "skipped", level: "skip", info: "gh not installed or remote is not GitHub" };
    default:
      return absurd(lookup, "PrLookup");
  }
}

function renderModelInfo(ai: ProviderConfig): string {
  const base = `${ai.provider} / ${ai.model}`;
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
      return "Unknown";
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
      return "Unknown";
  }
}
