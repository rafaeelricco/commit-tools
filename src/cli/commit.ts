/*
The default command: turn the staged diff into a commit message, then commit and optionally push.

`Commit.create` loads config (running `Setup` when that fails, a corrupt file included) and
refreshes OAuth tokens. `Commit.run` owns everything after that and logs any failure once, in red.

    Commit.run()
        |-- 1. checkIsGitRepo(), then getStagedSnapshot() and listStagedPaths() together,
        |      then buildStagedContext() once: whole diff under budget, else compressed
        |-- 2. route()
        |        only generated files staged --> generatedOnlyMessage(), no model call for this draft
        |        split_commits on, 2+ files ---> generateSplitPlan() --> followAnalysis()
        |                                          should_split and 2+ groups --> Split.runPlan()
        |                                          otherwise --> the first group's message
        |        otherwise --------------------> generateCommitMessage()
        |-- 3. interact()   commit | commit + push | regenerate | adjust | cancel
        |                   regenerate resends context.diff; adjust sends only the manifest
        |-- 4. performCommit(), then pushAfterCommit() when asked
        v
    push: no upstream --> offer to publish; rejected as non-fast-forward --> offer --force-with-lease

Nothing staged fails step 1 with "No staged changes found". Cancelling the action menu ends
with "Operation cancelled."; cancelling the adjust prompt returns to the menu. A failed push
leaves the commit in place.
*/
export { Commit, compressionNote, routeAnalysis, type AnalysisRoute };

import * as p from "@clack/prompts";
import * as pr from "@/infra/github/pr";
import * as repo from "@/infra/git/repo";
import { isGeneratedPath } from "@/infra/git/parsers";
import { generatedOnlyMessage } from "@/domain/commit/generated-only";

import { Future } from "@/libs/future";
import { loadConfig } from "@/infra/storage/config";
import { Setup } from "@/cli/setup";
import { Split } from "@/cli/split";
import { type CommitConvention, type Config, type ProviderConfig } from "@/domain/config/config";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import {
  generateCommitMessage,
  generateSplitPlan,
  refineCommitMessage,
  type GeneratedContent,
  type LlmRequestMetadata,
  type SplitPlanContent
} from "@/domain/llm/router";
import { type SplitPlan } from "@/domain/split/plan";
import { buildStagedContext, type StagedContext } from "@/domain/context/context";
import { Nothing, type Maybe, Just, fromOptional } from "@/libs/maybe";
import { Failure, Success, type Result } from "@/libs/result";
import { absurd } from "@/libs/types";
import { loading, quietLoading } from "@/infra/ui/spinner";
import { renderCommitNote, renderPushNote } from "@/infra/ui/push-note";

import color from "picocolors";

const USER_ACTIONS = ["commit_push", "commit", "regenerate", "adjust", "cancel"] as const;
type UserAction = (typeof USER_ACTIONS)[number];

type AnalysisRoute = { tag: "split"; plan: SplitPlan } | { tag: "single"; message: string };

type Proposal = { readonly text: string; readonly metadata: Maybe<LlmRequestMetadata> };

const fromGenerated = (generated: GeneratedContent): Proposal => ({ text: generated.text, metadata: Just(generated.metadata) });

const formatTokens = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

const compressionNote = (tokens: number, fullTokens: number): string => {
  const saved = Math.round((1 - tokens / fullTokens) * 100);
  return `Large diff compressed ${saved}% for the model: ~${formatTokens(fullTokens)} → ~${formatTokens(tokens)} tokens`;
};

const routeAnalysis = (plan: SplitPlan): Result<Error, AnalysisRoute> =>
  plan.shouldSplit && plan.commits.length >= 2 ?
    Success({ tag: "split", plan })
  : fromOptional(plan.commits[0]).unwrap<Result<Error, AnalysisRoute>>(
      () => Failure(new Error("Split plan: expected at least 1 commit")),
      (first) => Success({ tag: "single", message: first.message })
    );

class Commit {
  private constructor(
    private readonly config: Config,
    private readonly providerConfig: ProviderConfig
  ) {}

  static create(): Future<Error, Commit> {
    return loadConfig()
      .chainRej((): Future<Error, Config> => {
        p.log.warn(color.yellow("No configuration found. Let's set you up first."));
        return Setup.create()
          .chain((s) => s.run())
          .chain(() => loadConfig());
      })
      .chain((config) => resolveProvider(config).map((ai) => new Commit(config, ai)));
  }

  run(): Future<Error, void> {
    return repo
      .checkIsGitRepo()
      .chain(() => Future.concurrently({ snapshot: repo.getStagedSnapshot(), files: repo.listStagedPaths() }))
      .chain(({ snapshot, files }) => this.route(buildStagedContext(snapshot, files)))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private route(context: StagedContext): Future<Error, void> {
    const { files } = context;
    if (files.every(isGeneratedPath)) {
      p.log.info("Only generated files are staged. Skipped the model.");
      return this.interact(context, { text: generatedOnlyMessage(files, this.config.commit_convention), metadata: Nothing() });
    }
    if (context.size.tag === "compressed") {
      p.log.info(compressionNote(context.size.tokens, context.size.fullTokens));
    }
    return this.config.split_commits && files.length >= 2 ?
        quietLoading(
          "Analyzing staged changes...",
          generateSplitPlan(this.providerConfig, context, this.config.commit_convention, this.config.custom_template)
        ).chain((content) => this.followAnalysis(context, content))
      : this.generate(context, this.config.commit_convention, this.config.custom_template).chain((message) =>
          this.interact(context, fromGenerated(message))
        );
  }

  private followAnalysis(context: StagedContext, content: SplitPlanContent): Future<Error, void> {
    const { plan, metadata } = content;
    return routeAnalysis(plan).either(
      (e) => Future.reject(e),
      (route) => {
        switch (route.tag) {
          case "split":
            return Split.fromResolved(this.config, this.providerConfig).runPlan(context, route.plan, metadata);
          case "single":
            return this.interact(context, { text: route.message, metadata: Just(metadata) });
          default:
            return absurd(route, "AnalysisRoute");
        }
      }
    );
  }

  generate(context: StagedContext, convention: CommitConvention, template: Maybe<string> = Nothing()): Future<Error, GeneratedContent> {
    return loading("Generating commit message...", "Message generated!", generateCommitMessage(this.providerConfig, context.diff, convention, template));
  }

  refine(message: string, adjustment: string, context: StagedContext): Future<Error, GeneratedContent> {
    return loading("Refining...", "Refined!", refineCommitMessage(this.providerConfig, message, adjustment, context.manifest));
  }

  commit(message: string): Future<Error, string> {
    return repo.performCommit(message);
  }

  push(request: Maybe<LlmRequestMetadata>, branch?: string, publish = false, forceWithLease = false): Future<Error, void> {
    const startMsg =
      forceWithLease ? "Force pushing with lease..."
      : publish ? `Publishing '${branch}'...`
      : "Pushing...";

    const endMsg =
      forceWithLease ? "Force pushed successfully!"
      : publish ? "Published successfully!"
      : "Pushed successfully!";

    return loading(startMsg, endMsg, repo.performPush(branch, publish, forceWithLease)).chain((result) =>
      Future.concurrently<
        Error,
        {
          commit: Maybe<repo.CommitMetadata>;
          localBranch: Maybe<string>;
          baseBranch: Maybe<string>;
          remoteUrl: Maybe<string>;
          pr: pr.PrLookup;
        }
      >({
        commit: repo.findCommitMetadata(),
        localBranch: repo.findCurrentBranch(),
        baseBranch: repo.findBaseBranch(),
        remoteUrl: repo.findTrackingRemoteUrl(),
        pr: pr.getOpenPullRequest()
      }).map((parts) => renderPushNote({ ...parts, range: result.range, request }))
    );
  }

  interact(context: StagedContext, proposal: Proposal): Future<Error, void> {
    return this.promptAction(proposal.text).chain((action) => {
      switch (action) {
        case "commit":
          return this.handleCommit(proposal);
        case "commit_push":
          return this.handleCommitAndPush(proposal);
        case "regenerate":
          return this.generate(context, this.config.commit_convention, this.config.custom_template).chain((msg) =>
            this.interact(context, fromGenerated(msg))
          );
        case "adjust":
          return this.handleAdjust(context, proposal);
        case "cancel":
          return Future.resolve(undefined);
      }
    });
  }

  static isNonFastForwardError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return msg.includes("non-fast-forward") || msg.includes("updates were rejected");
  }

  private promptAction(message: string): Future<Error, UserAction> {
    return Future.attemptP(async () => {
      p.note(message, "Proposed Commit Message");

      const action = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "commit_push" as const, label: "Commit & Push" },
          { value: "commit" as const, label: "Commit" },
          { value: "regenerate" as const, label: "Regenerate" },
          { value: "adjust" as const, label: "Adjust" },
          { value: "cancel" as const, label: "Cancel" }
        ]
      });

      if (p.isCancel(action) || action === "cancel") {
        p.outro("Operation cancelled.");
        return "cancel";
      }

      return action;
    });
  }

  private handleCommit(proposal: Proposal): Future<Error, void> {
    return this.commit(proposal.text).chain((stats) =>
      repo.findCommitMetadata().map((commit) => {
        process.stdout.write(stats);
        renderCommitNote({ commit, request: proposal.metadata });
        p.outro(color.green("Committed successfully!"));
      })
    );
  }

  private handleCommitAndPush(proposal: Proposal): Future<Error, void> {
    return this.commit(proposal.text)
      .chain((stats) => {
        process.stdout.write(stats);
        return this.pushAfterCommit(proposal.metadata);
      })
      .map(() => {
        p.outro(color.green("Done!"));
      });
  }

  private pushAfterCommit(request: Maybe<LlmRequestMetadata>): Future<Error, void> {
    return repo
      .hasUpstream()
      .chain((exists) =>
        exists ?
          this.push(request).chainRej((err) => (Commit.isNonFastForwardError(err) ? this.promptForceWithLease(request) : Future.reject(err)))
        : this.promptPublishBranch(request)
      );
  }

  private promptPublishBranch(request: Maybe<LlmRequestMetadata>): Future<Error, void> {
    return repo.getCurrentBranch().chain((branch) =>
      Future.attemptP(async () => {
        const publish = await p.confirm({
          message: `Branch '${branch}' has no upstream. Publish to origin?`
        });
        return !(p.isCancel(publish) || !publish);
      }).chain((shouldPublish) => (shouldPublish ? this.push(request, branch, true) : Future.resolve(undefined)))
    );
  }

  private promptForceWithLease(request: Maybe<LlmRequestMetadata>): Future<Error, void> {
    return Future.attemptP(async () => {
      const force = await p.confirm({
        message: "Push was rejected (branch is behind remote). Force push with lease?"
      });
      return !(p.isCancel(force) || !force);
    }).chain((shouldForce) => (shouldForce ? this.push(request, undefined, false, true) : Future.resolve(undefined)));
  }

  private handleAdjust(context: StagedContext, proposal: Proposal): Future<Error, void> {
    return this.promptAdjustment().chain((maybeAdj) =>
      maybeAdj instanceof Nothing ?
        this.interact(context, proposal)
      : this.refine(proposal.text, maybeAdj.value, context).chain((refined) => this.interact(context, fromGenerated(refined)))
    );
  }

  private promptAdjustment(): Future<Error, Maybe<string>> {
    return Future.attemptP(async () => {
      const adj = await p.text({
        message: "What adjustments would you like?",
        placeholder: "e.g. make it more concise"
      });
      return p.isCancel(adj) ? Nothing<string>() : Just(adj);
    });
  }
}
