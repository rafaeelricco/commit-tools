export { Branch };

import * as p from "@clack/prompts";
import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { loadConfig } from "@/infra/storage/config";
import { Setup } from "@/cli/setup";
import { type Config, type ProviderConfig } from "@/domain/config/config";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import { generateBranchNameSuggestions } from "@/domain/llm/router";
import { loading } from "@/infra/ui/spinner";

import color from "picocolors";

class Branch {
  private constructor(private readonly providerConfig: ProviderConfig) {}

  static create(): Future<Error, Branch> {
    return loadConfig()
      .chainRej((): Future<Error, Config> => {
        p.log.warn(color.yellow("No configuration found. Let's set you up first."));
        return Setup.create()
          .chain((s) => s.run())
          .chain(() => loadConfig());
      })
      .chain((config) => resolveProvider(config).map((ai) => new Branch(ai)));
  }

  run(): Future<Error, void> {
    return repo
      .checkIsGitRepo()
      .chain(() => repo.getLocalChangeContext())
      .chain((ctx) => loading("Suggesting branch names...", "Suggestions ready!", generateBranchNameSuggestions(this.providerConfig, ctx)))
      .chain((s) => this.promptPick(s.names).chain((picked) => repo.createAndSwitchBranch(picked)))
      .map(() => {
        p.outro(color.green("Switched to new branch."));
      })
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private promptPick(names: readonly [string, string, string]): Future<Error, string> {
    return Future.attemptP(async () => {
      const choice = await p.select({
        message: "Create branch",
        options: names.map((value) => ({ value, label: value }))
      });

      if (p.isCancel(choice)) {
        p.outro("Operation cancelled.");
        throw new Error("Operation cancelled.");
      }

      return choice;
    });
  }
}
