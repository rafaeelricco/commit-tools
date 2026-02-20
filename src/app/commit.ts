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
import { Just, Nothing, type Maybe } from "@/libs/maybe";

import color from "picocolors";

const USER_ACTIONS = ["commit_push", "commit", "regenerate", "adjust", "cancel"] as const;
type UserAction = (typeof USER_ACTIONS)[number];

type LoopContext = {
  readonly auth: AuthCredentials;
  readonly diff: string;
  readonly message: string;
};

const loading = <T>(loadingMessage: string, stopLabel: string, f: Future<Error, T>): Future<Error, T> => {
  const s = p.spinner();
  s.start(loadingMessage);
  return f
    .map((v) => {
      s.stop(stopLabel);
      return v;
    })
    .mapRej((e) => {
      s.stop("Failed.");
      return e;
    });
};

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
      resolveAuth(deps, config).chain((auth) => {
        const template = config.custom_template.maybe(undefined, (t) => t);
        return checkIsGitRepo()
          .chain(() => getStagedDiff())
          .chain((diff) =>
            generateCommit(auth, diff, config.commit_convention, template).map((message) => ({ auth, diff, message }))
          )
          .chain(interactionLoop);
      })
    )
    .mapRej((e) => {
      if (e instanceof Error) {
        p.log.error(color.red(e.message));
      }
      return e;
    });

const generateCommit = (
  auth: AuthCredentials,
  diff: string,
  convention: CommitConvention,
  customTemplate?: string
): Future<Error, string> =>
  loading(
    "Generating commit message...",
    "Message generated!",
    generateCommitMessage(auth, diff, convention, customTemplate)
  );

const handleCommit = (message: string): Future<Error, void> =>
  performCommit(message).map((stats) => {
    process.stdout.write(stats);
    p.outro(color.green("Committed successfully!"));
  });

const promptPublishBranch = (): Future<Error, void> =>
  getCurrentBranch().chain((branch) =>
    Future.attemptP(async () => {
      const publish = await p.confirm({
        message: `Branch '${branch}' has no upstream. Publish to origin?`
      });
      return !(p.isCancel(publish) || !publish);
    }).chain((shouldPublish) =>
      shouldPublish ?
        loading(`Publishing '${branch}'...`, "Published successfully!", performPush(branch, true)).map(() => {})
      : Future.resolve(undefined)
    )
  );

const pushAfterCommit = (): Future<Error, void> =>
  hasUpstream().chain((exists) =>
    exists ? loading("Pushing...", "Pushed successfully!", performPush()).map(() => {}) : promptPublishBranch()
  );

const handleCommitAndPush = (message: string): Future<Error, void> =>
  performCommit(message)
    .chain((stats) => {
      process.stdout.write(stats);
      return pushAfterCommit();
    })
    .map(() => {
      p.outro(color.green("Done!"));
    });

const promptAdjustment = (): Future<Error, Maybe<string>> =>
  Future.attemptP(async () => {
    const adj = await p.text({
      message: "What adjustments would you like?",
      placeholder: "e.g. make it more concise"
    });
    return p.isCancel(adj) ? Nothing<string>() : Just(adj as string);
  });

const handleAdjust = (ctx: LoopContext): Future<Error, void> =>
  promptAdjustment().chain((maybeAdj) =>
    maybeAdj instanceof Nothing ?
      interactionLoop(ctx)
    : loading("Refining...", "Refined!", refineCommitMessage(ctx.auth, ctx.message, maybeAdj.value, ctx.diff)).chain(
        (message) => interactionLoop({ ...ctx, message })
      )
  );

const interactionLoop = (ctx: LoopContext): Future<Error, void> =>
  Future.attemptP(async () => {
    p.note(ctx.message, "Proposed Commit Message");

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
  }).chain((action) => {
    switch (action) {
      case "commit":
        return handleCommit(ctx.message);
      case "commit_push":
        return handleCommitAndPush(ctx.message);
      case "regenerate":
        return generateCommit(ctx.auth, ctx.diff, "imperative").chain((message) =>
          interactionLoop({ ...ctx, message })
        );
      case "adjust":
        return handleAdjust(ctx);
      case "cancel":
        return Future.resolve(undefined);
    }
  });
