import * as p from "@clack/prompts";
import color from "picocolors";
import { Future } from "@/future";
import { loadConfig } from "@infra/config/storage";
import { CommitConvention } from "@domain/config/schema";
import { 
  checkIsGitRepo, 
  getStagedDiff, 
  performCommit, 
  performPush, 
  getCurrentBranch, 
  hasUpstream, 
  NoStagedChanges 
} from "@infra/git";
import { generateCommitMessage, refineCommitMessage } from "@infra/ai/gemini";

export const executeCommitFlow = (): Future<Error, void> =>
  loadConfig()
    .chain(config => 
      checkIsGitRepo().chain(() =>
        getStagedDiff().chain(diff =>
          generateWithSpinner(config.api_key, diff, config.commit_convention, config.custom_template)
            .chain(message => interactionLoop(config.api_key, diff, message))
        )
      )
    )
    .mapRej(e => {
      if (e instanceof NoStagedChanges) {
        p.log.warn(color.yellow("No staged changes found. Use 'git add' to stage files."));
        return e;
      }
      p.log.error(color.red(e.message));
      return e;
    });

const generateWithSpinner = (
  apiKey: string,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> => {
  const s = p.spinner();
  s.start("Generating commit message...");
  return generateCommitMessage(apiKey, diff, convention, customTemplate)
    .map(msg => {
      s.stop("Message generated!");
      return msg;
    })
    .mapRej(e => {
      s.stop("Generation failed.");
      return e;
    });
};

const interactionLoop = (
  apiKey: string,
  diff: string,
  message: string
): Future<Error, void> => {
  return Future.attemptP(async () => {
    p.note(message, "Proposed Commit Message");

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "commit_push", label: "Commit & Push" },
        { value: "commit", label: "Commit" },
        { value: "regenerate", label: "Regenerate" },
        { value: "adjust", label: "Adjust" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.outro("Operation cancelled.");
      return "cancel";
    }

    return action as string;
  }).chain(action => {
    switch (action) {
      case "commit":
        return performCommit(message).map(stats => {
          process.stdout.write(stats);
          p.outro(color.green("Committed successfully!"));
        });
      case "commit_push":
        return performCommit(message)
          .chain(stats => {
            process.stdout.write(stats);
            return hasUpstream().chain(exists => {
              if (exists) {
                const s = p.spinner();
                s.start("Pushing...");
                return performPush().map(() => s.stop("Pushed successfully!"));
              } else {
                return getCurrentBranch().chain(branch => 
                  Future.attemptP(async () => {
                    const publish = await p.confirm({
                      message: `Branch '${branch}' has no upstream. Publish to origin?`,
                    });
                    if (p.isCancel(publish) || !publish) return "skip_push";
                    return "publish";
                  }).chain(pubAction => {
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
        return generateWithSpinner(apiKey, diff, "imperative")
          .chain(newMsg => interactionLoop(apiKey, diff, newMsg));
      case "adjust":
        return Future.attemptP(async () => {
          const adj = await p.text({
            message: "What adjustments would you like?",
            placeholder: "e.g. make it more concise",
          });
          if (p.isCancel(adj)) return null;
          return adj;
        }).chain(adj => {
          if (!adj) return interactionLoop(apiKey, diff, message);
          const s = p.spinner();
          s.start("Refining...");
          return refineCommitMessage(apiKey, message, adj, diff)
            .map(newMsg => {
              s.stop("Refined!");
              return newMsg;
            })
            .chain(newMsg => interactionLoop(apiKey, diff, newMsg));
        });
      default:
        return Future.resolve(undefined);
    }
  });
};
