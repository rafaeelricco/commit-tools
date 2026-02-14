import * as p from "@clack/prompts";
import color from "picocolors";
import { Future } from "@/future";
import { loadConfig, CommitConvention } from "../config";
import { checkGitRepo, getStagedDiff, commit, push, NoStagedChanges } from "../git";
import { generateCommitMessage, refineCommitMessage, AIError } from "../ai";

export const executeCommitFlow = (): Future<Error, void> =>
  loadConfig()
    .chain(config => 
      checkGitRepo().chain(cwd =>
        getStagedDiff(cwd).chain(diff =>
          generateWithSpinner(config.api_key, diff, config.commit_convention, config.custom_template)
            .chain(message => interactionLoop(config.api_key, diff, message, cwd))
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
): Future<AIError, string> => {
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
  message: string,
  cwd: string
): Future<Error, void> => {
  return Future.attemptP(async () => {
    p.note(message, "Proposed Commit Message");

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "commit", label: "Commit" },
        { value: "commit_push", label: "Commit & Push" },
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
        return commit(message, cwd).map(() => {
          p.outro(color.green("Committed successfully!"));
        });
      case "commit_push":
        return commit(message, cwd)
          .chain(() => {
            const s = p.spinner();
            s.start("Pushing...");
            return push(cwd).map(() => s.stop("Pushed successfully!"));
          })
          .map(() => {
            p.outro(color.green("Committed and pushed successfully!"));
          });
      case "regenerate":
        return generateWithSpinner(apiKey, diff, "imperative") // Defaulting for simple retry
          .chain(newMsg => interactionLoop(apiKey, diff, newMsg, cwd));
      case "adjust":
        return Future.attemptP(async () => {
          const adj = await p.text({
            message: "What adjustments would you like?",
            placeholder: "e.g. make it more concise",
          });
          if (p.isCancel(adj)) return null;
          return adj;
        }).chain(adj => {
          if (!adj) return interactionLoop(apiKey, diff, message, cwd);
          const s = p.spinner();
          s.start("Refining...");
          return refineCommitMessage(apiKey, message, adj, diff)
            .map(newMsg => {
              s.stop("Refined!");
              return newMsg;
            })
            .chain(newMsg => interactionLoop(apiKey, diff, newMsg, cwd));
        });
      default:
        return Future.resolve(undefined);
    }
  });
};
