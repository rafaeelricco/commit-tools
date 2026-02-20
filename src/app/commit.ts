export { executeCommitFlow };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { loadConfig, updateTokens } from "@/app/storage";
import { executeSetupFlow } from "@/app/setup";
import { CommitConvention, type Config } from "@/app/services/config";
import { ensureFreshTokens } from "@/app/services/googleAuth";
import type { Dependencies } from "@/app/integrations";
import {
  checkIsGitRepo,
  getStagedDiff,
  performCommit,
  performPush,
  getCurrentBranch,
  hasUpstream
} from "@/app/services";
import {
  generateCommitMessage,
  refineCommitMessage,
  getAuthCredentials,
  type AuthCredentials
} from "@/app/services/gemini";
import { Nothing } from "@/libs/maybe";

import color from "picocolors";

const resolveAuth = (deps: Dependencies, config: Config): Future<Error, AuthCredentials> => {
  const credentials = getAuthCredentials(config);

  if (credentials instanceof Nothing) {
    return Future.reject(new Error("No authentication configured. Run 'commit-tools setup' to configure."));
  }

  const creds = credentials.value;

  if (creds.method === "oauth") {
    return ensureFreshTokens(deps, creds.tokens).chain((freshTokens) => {
      const tokensChanged =
        freshTokens.access_token !== creds.tokens.access_token || freshTokens.expiry_date !== creds.tokens.expiry_date;

      const persist = tokensChanged ? updateTokens(freshTokens) : Future.resolve<Error, void>(undefined);

      return persist.map(() => ({
        method: "oauth" as const,
        tokens: freshTokens
      }));
    });
  }

  return Future.resolve(creds);
};

const executeCommitFlow = (deps: Dependencies): Future<Error, void> =>
  loadConfig()
    .chainRej(() => {
      p.log.warn(color.yellow("No configuration found. Let's set you up first."));
      return executeSetupFlow(deps).chain(() => loadConfig());
    })
    .chain((config) =>
      resolveAuth(deps, config).chain((auth) =>
        checkIsGitRepo().chain(() =>
          getStagedDiff().chain((diff) =>
            generateWithSpinner(
              auth,
              diff,
              config.commit_convention,
              config.custom_template.maybe(undefined, (t) => t)
            ).chain((message) => interactionLoop(auth, diff, message))
          )
        )
      )
    )
    .mapRej((e) => {
      if (e instanceof Error) {
        p.log.error(color.red(e.message));
      }
      return e;
    });

const generateWithSpinner = (
  auth: AuthCredentials,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> => {
  const s = p.spinner();
  s.start("Generating commit message...");
  return generateCommitMessage(auth, diff, convention, customTemplate)
    .map((msg) => {
      s.stop("Message generated!");
      return msg;
    })
    .mapRej((e) => {
      s.stop("Generation failed.");
      return e;
    });
};

const interactionLoop = (auth: AuthCredentials, diff: string, message: string): Future<Error, void> => {
  return Future.attemptP(async () => {
    p.note(message, "Proposed Commit Message");

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "commit_push", label: "Commit & Push" },
        { value: "commit", label: "Commit" },
        { value: "regenerate", label: "Regenerate" },
        { value: "adjust", label: "Adjust" },
        { value: "cancel", label: "Cancel" }
      ]
    });

    if (p.isCancel(action) || action === "cancel") {
      p.outro("Operation cancelled.");
      return "cancel";
    }

    return action as string;
  }).chain((action) => {
    switch (action) {
      case "commit":
        return performCommit(message).map((stats) => {
          process.stdout.write(stats);
          p.outro(color.green("Committed successfully!"));
        });
      case "commit_push":
        return performCommit(message)
          .chain((stats) => {
            process.stdout.write(stats);
            return hasUpstream().chain((exists) => {
              if (exists) {
                const s = p.spinner();
                s.start("Pushing...");
                return performPush().map(() => s.stop("Pushed successfully!"));
              } else {
                return getCurrentBranch().chain((branch) =>
                  Future.attemptP(async () => {
                    const publish = await p.confirm({
                      message: `Branch '${branch}' has no upstream. Publish to origin?`
                    });
                    if (p.isCancel(publish) || !publish) return "skip_push";
                    return "publish";
                  }).chain((pubAction) => {
                    if (pubAction === "skip_push") return Future.resolve(undefined);
                    const s = p.spinner();
                    s.start(`Publishing '${branch}'...`);
                    return performPush(branch, true).map(() => s.stop("Published successfully!"));
                  })
                );
              }
            });
          })
          .map(() => {
            p.outro(color.green("Done!"));
          });
      case "regenerate":
        return generateWithSpinner(auth, diff, "imperative").chain((newMsg) => interactionLoop(auth, diff, newMsg));
      case "adjust":
        return Future.attemptP(async () => {
          const adj = await p.text({
            message: "What adjustments would you like?",
            placeholder: "e.g. make it more concise"
          });
          if (p.isCancel(adj)) return null;
          return adj;
        }).chain((adj) => {
          if (!adj) return interactionLoop(auth, diff, message);
          const s = p.spinner();
          s.start("Refining...");
          return refineCommitMessage(auth, message, adj, diff)
            .map((newMsg) => {
              s.stop("Refined!");
              return newMsg;
            })
            .chain((newMsg) => interactionLoop(auth, diff, newMsg));
        });
      default:
        return Future.resolve(undefined);
    }
  });
};
