export { Branch };

import * as p from "@clack/prompts";
import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { loadConfig } from "@/infra/storage/config";
import { Setup } from "@/cli/setup";
import { type Config, type ProviderConfig } from "@/domain/config/config";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import { generateBranchNameSuggestions, type BranchSuggestion } from "@/domain/llm/router";
import { renderBranchNote } from "@/infra/ui/push-note";
import { loading } from "@/infra/ui/spinner";
import { Just, Nothing, type Maybe } from "@/libs/maybe";

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
      .bichain(
        (e): Future<Error, void> => {
          if (repo.isNoLocalChangesError(e)) {
            p.log.warn(color.yellow(repo.NO_LOCAL_CHANGES_MESSAGE));
            p.outro("No local changes — nothing to suggest a branch for.");
            return Future.resolve(undefined);
          }
          return Future.reject(e);
        },
        (ctx): Future<Error, void> =>
          loading("Suggesting branch names...", "Suggestions ready!", generateBranchNameSuggestions(this.providerConfig, ctx))
            .chain((s) =>
              this.promptPick(s.names).chain(
                (maybePicked): Future<Error, { picked: string; metadata: typeof s.metadata } | undefined> =>
                  maybePicked.maybe<Future<Error, { picked: string; metadata: typeof s.metadata } | undefined>>(Future.resolve(undefined), (picked) =>
                    this.confirmForkFromBase().chain((proceed) => {
                      if (!proceed) {
                        p.outro("Operation cancelled.");
                        return Future.resolve(undefined);
                      }
                      return repo.createAndSwitchBranch(picked).map(() => ({ picked, metadata: s.metadata }));
                    })
                  )
              )
            )
            .chain((result) => {
              if (!result) return Future.resolve(undefined);
              return repo.findBaseBranch().map((baseBranch) => {
                renderBranchNote({
                  branch: result.picked,
                  baseBranch,
                  request: Just(result.metadata)
                });
                p.outro(color.green("Switched to new branch."));
              });
            })
      )
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private confirmForkFromBase(): Future<Error, boolean> {
    return Future.concurrently<Error, { current: Maybe<string>; base: Maybe<string> }>({
      current: repo.findCurrentBranch(),
      base: repo.findBaseBranch()
    }).chain(({ current, base }) =>
      current.maybe(Future.resolve(true), (curr) =>
        base.maybe(Future.resolve(true), (b) =>
          curr === b ?
            Future.resolve(true)
          : Future.attemptP(async () => {
              p.log.warn(color.yellow(`You're on '${curr}', not the base branch '${b}'. The new branch will fork from '${curr}'.`));
              const ok = await p.confirm({ message: `Create branch off '${curr}' anyway?` });
              return !(p.isCancel(ok) || !ok);
            })
        )
      )
    );
  }

  private promptPick(suggestions: readonly [BranchSuggestion, BranchSuggestion, BranchSuggestion]): Future<Error, Maybe<string>> {
    return Future.attemptP(async () => {
      const choice = await p.select({
        message: "Create branch",
        options: suggestions.map((s) => ({ value: s.name, label: `${s.name} — ${s.rationale}` }))
      });

      if (p.isCancel(choice)) {
        p.outro("Operation cancelled.");
        return Nothing<string>();
      }

      return Just(choice);
    });
  }
}
