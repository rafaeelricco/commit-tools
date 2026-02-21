export { Commit };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { loadConfig, updateTokens } from "@/app/storage";
import { Setup } from "@/app/setup";
import { CommitConvention, type Config } from "@/app/services/config";
import { ensureFreshTokens } from "@/app/services/googleAuth";
import { Dependencies } from "@/app/integrations";
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
import { Nothing, type Maybe, Just } from "@/libs/maybe";
import { loading } from "@/app/ui";

import color from "picocolors";

const USER_ACTIONS = ["commit_push", "commit", "regenerate", "adjust", "cancel"] as const;
type UserAction = (typeof USER_ACTIONS)[number];

class Commit {
  private constructor(
    private readonly config: Config,
    private readonly auth: AuthCredentials
  ) {}

  static create(deps: Dependencies): Future<Error, Commit> {
    return loadConfig()
      .chainRej((): Future<Error, Config> => {
        p.log.warn(color.yellow("No configuration found. Let's set you up first."));
        return Setup.create(deps)
          .chain((s) => s.run())
          .chain(() => loadConfig());
      })
      .chain((config) => Commit.resolveAuth(deps, config).map((auth) => new Commit(config, auth)));
  }

  run(): Future<Error, void> {
    return checkIsGitRepo()
      .chain(() => this.diff())
      .chain((diff) => this.generate(diff).chain((message) => this.interact(diff, message)))
      .mapRej((e) => {
        if (e instanceof Error) {
          p.log.error(color.red(e.message));
        }
        return e;
      });
  }

  diff(): Future<Error, string> {
    return getStagedDiff();
  }

  generate(diff: string, convention?: CommitConvention, template?: string): Future<Error, string> {
    return loading(
      "Generating commit message...",
      "Message generated!",
      generateCommitMessage(
        this.auth,
        diff,
        convention ?? this.config.commit_convention,
        template ?? this.config.custom_template.maybe(undefined, (t) => t)
      )
    );
  }

  refine(message: string, adjustment: string, diff: string): Future<Error, string> {
    return loading("Refining...", "Refined!", refineCommitMessage(this.auth, message, adjustment, diff));
  }

  commit(message: string): Future<Error, string> {
    return performCommit(message);
  }

  push(branch?: string, publish = false): Future<Error, void> {
    return loading(
      publish ? `Publishing '${branch}'...` : "Pushing...",
      publish ? "Published successfully!" : "Pushed successfully!",
      performPush(branch, publish)
    ).map(() => {});
  }

  interact(diff: string, message: string): Future<Error, void> {
    return this.promptAction(message).chain((action) => {
      switch (action) {
        case "commit":
          return this.handleCommit(message);
        case "commit_push":
          return this.handleCommitAndPush(message);
        case "regenerate":
          return this.generate(diff, "imperative").chain((msg) => this.interact(diff, msg));
        case "adjust":
          return this.handleAdjust(diff, message);
        case "cancel":
          return Future.resolve(undefined);
      }
    });
  }

  private static resolveAuth(deps: Dependencies, config: Config): Future<Error, AuthCredentials> {
    const credentials = getAuthCredentials(config);

    if (credentials instanceof Nothing) {
      return Future.reject(new Error("No authentication configured. Run 'commit-tools setup' to configure."));
    }

    const creds = credentials.value;

    if (creds.method === "oauth") {
      return ensureFreshTokens(deps, creds.tokens).chain((freshTokens) => {
        const tokensChanged =
          freshTokens.access_token !== creds.tokens.access_token ||
          freshTokens.expiry_date !== creds.tokens.expiry_date;

        const persist = tokensChanged ? updateTokens(freshTokens) : Future.resolve<Error, void>(undefined);

        return persist.map(() => ({
          method: "oauth" as const,
          tokens: freshTokens
        }));
      });
    }

    return Future.resolve(creds);
  }

  private promptAction(message: string): Future<Error, UserAction> {
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
        return "cancel" as UserAction;
      }

      return action as UserAction;
    });
  }

  private handleCommit(message: string): Future<Error, void> {
    return this.commit(message).map((stats) => {
      process.stdout.write(stats);
      p.outro(color.green("Committed successfully!"));
    });
  }

  private handleCommitAndPush(message: string): Future<Error, void> {
    return this.commit(message)
      .chain((stats) => {
        process.stdout.write(stats);
        return this.pushAfterCommit();
      })
      .map(() => {
        p.outro(color.green("Done!"));
      });
  }

  private pushAfterCommit(): Future<Error, void> {
    return hasUpstream().chain((exists) => (exists ? this.push() : this.promptPublishBranch()));
  }

  private promptPublishBranch(): Future<Error, void> {
    return getCurrentBranch().chain((branch) =>
      Future.attemptP(async () => {
        const publish = await p.confirm({
          message: `Branch '${branch}' has no upstream. Publish to origin?`
        });
        return !(p.isCancel(publish) || !publish);
      }).chain((shouldPublish) => (shouldPublish ? this.push(branch, true) : Future.resolve(undefined)))
    );
  }

  private handleAdjust(diff: string, message: string): Future<Error, void> {
    return this.promptAdjustment().chain((maybeAdj) =>
      maybeAdj instanceof Nothing ?
        this.interact(diff, message)
      : this.refine(message, maybeAdj.value, diff).chain((refined) => this.interact(diff, refined))
    );
  }

  private promptAdjustment(): Future<Error, Maybe<string>> {
    return Future.attemptP(async () => {
      const adj = await p.text({
        message: "What adjustments would you like?",
        placeholder: "e.g. make it more concise"
      });
      return p.isCancel(adj) ? Nothing<string>() : Just(adj as string);
    });
  }
}
