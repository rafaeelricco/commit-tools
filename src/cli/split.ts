export { Split };

import * as p from "@clack/prompts";
import * as pr from "@/infra/github/pr";
import * as repo from "@/infra/git/repo";

import { Future } from "@/libs/future";
import { loadConfig } from "@/infra/storage/config";
import { Setup } from "@/cli/setup";
import { Commit } from "@/cli/commit";
import { type Config, type ProviderConfig } from "@/domain/config/config";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import { generateSplitPlan, type LlmRequestMetadata, type SplitPlanContent } from "@/domain/llm/router";
import { type SplitPlan } from "@/domain/split/plan";
import { Just, type Maybe } from "@/libs/maybe";
import { loading } from "@/infra/ui/spinner";
import { renderCommitNote, renderPushNote } from "@/infra/ui/push-note";
import { absurd } from "@/libs/types";

import color from "picocolors";

const SPLIT_ACTIONS = ["apply_push", "apply", "edit", "move", "reorder", "regenerate", "cancel"] as const;
type SplitAction = (typeof SPLIT_ACTIONS)[number];

const formatPlanNote = (plan: SplitPlan, stagedCount: number): string => {
  const groups = plan.commits.map((commit, index) => `${index + 1}. ${commit.message}\n   ${commit.files.join("  ")}`).join("\n\n");
  return `${plan.commits.length} commits · ${stagedCount} staged files\n\n${groups}`;
};

const commitOptions = (plan: SplitPlan): { value: number; label: string }[] =>
  plan.commits.map((commit, index) => ({ value: index, label: `${index + 1}. ${commit.message}` }));

const withEditedMessage = (plan: SplitPlan, index: number, message: string): SplitPlan => ({
  commits: plan.commits.map((commit, i) => (i === index ? { message, files: commit.files } : commit))
});

const withMovedFile = (plan: SplitPlan, file: string, destIndex: number): SplitPlan => {
  const sourceIndex = plan.commits.findIndex((commit) => commit.files.includes(file));
  if (sourceIndex === -1 || sourceIndex === destIndex) {
    return plan;
  }
  const moved = plan.commits.map((commit, i) => {
    if (i === sourceIndex) {
      return { message: commit.message, files: commit.files.filter((path) => path !== file) };
    }
    if (i === destIndex) {
      return { message: commit.message, files: [...commit.files, file] };
    }
    return commit;
  });
  return { commits: moved.filter((commit) => commit.files.length > 0) };
};

const withReorderedCommit = (plan: SplitPlan, fromIndex: number, toIndex: number): SplitPlan => {
  if (fromIndex === toIndex) {
    return plan;
  }
  const commits = [...plan.commits];
  const [item] = commits.splice(fromIndex, 1);
  if (item === undefined) {
    return plan;
  }
  commits.splice(toIndex, 0, item);
  return { commits };
};

class Split {
  private constructor(
    private readonly config: Config,
    private readonly providerConfig: ProviderConfig
  ) {}

  static create(): Future<Error, Split> {
    return loadConfig()
      .chainRej((): Future<Error, Config> => {
        p.log.warn(color.yellow("No configuration found. Let's set you up first."));
        return Setup.create()
          .chain((s) => s.run())
          .chain(() => loadConfig());
      })
      .chain((config) => resolveProvider(config).map((ai) => new Split(config, ai)));
  }

  run(): Future<Error, void> {
    return repo
      .checkIsGitRepo()
      .chain(() => Future.concurrently({ diff: repo.getStagedDiff(), files: repo.listStagedPaths() }))
      .chain(({ diff, files }) => this.generate(diff, files).chain((content) => this.interact(diff, files, content.plan, content.metadata)))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private generate(diff: string, files: readonly string[]): Future<Error, SplitPlanContent> {
    return loading(
      "Generating split plan...",
      "Split plan generated!",
      generateSplitPlan(this.providerConfig, diff, files, this.config.commit_convention, this.config.custom_template)
    );
  }

  private interact(diff: string, files: readonly string[], plan: SplitPlan, meta: LlmRequestMetadata): Future<Error, void> {
    return this.promptAction(plan, files.length).chain((action) => {
      switch (action) {
        case "apply_push":
          return this.apply(plan, meta, true);
        case "apply":
          return this.apply(plan, meta, false);
        case "edit":
          return this.editMessage(plan).chain((next) => this.interact(diff, files, next, meta));
        case "move":
          return this.moveFile(plan).chain((next) => this.interact(diff, files, next, meta));
        case "reorder":
          return this.reorder(plan).chain((next) => this.interact(diff, files, next, meta));
        case "regenerate":
          return this.generate(diff, files).chain((c) => this.interact(diff, files, c.plan, c.metadata));
        case "cancel":
          return Future.resolve(undefined);
        default:
          return absurd(action, "SplitAction");
      }
    });
  }

  private promptAction(plan: SplitPlan, stagedCount: number): Future<Error, SplitAction> {
    return Future.attemptP(async () => {
      p.note(formatPlanNote(plan, stagedCount), "Split Plan");

      const action = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "apply_push", label: "Apply & Push" },
          { value: "apply", label: "Apply" },
          { value: "edit", label: "Edit message" },
          { value: "move", label: "Move file" },
          { value: "reorder", label: "Reorder" },
          { value: "regenerate", label: "Regenerate" },
          { value: "cancel", label: "Cancel" }
        ]
      });

      if (p.isCancel(action) || action === "cancel") {
        p.outro("Operation cancelled.");
        return "cancel";
      }

      return action;
    });
  }

  private editMessage(plan: SplitPlan): Future<Error, SplitPlan> {
    return Future.attemptP(async () => {
      const picked = await p.select({
        message: "Which commit?",
        options: commitOptions(plan)
      });
      if (p.isCancel(picked)) {
        return plan;
      }
      const current = plan.commits[picked];
      if (current === undefined) {
        return plan;
      }
      const next = await p.text({
        message: "New message",
        initialValue: current.message
      });
      if (p.isCancel(next)) {
        return plan;
      }
      const message = next.trim();
      return message.length === 0 ? plan : withEditedMessage(plan, picked, message);
    });
  }

  private moveFile(plan: SplitPlan): Future<Error, SplitPlan> {
    return Future.attemptP(async () => {
      const file = await p.select({
        message: "Move which file?",
        options: plan.commits.flatMap((commit) => commit.files.map((path) => ({ value: path, label: path })))
      });
      if (p.isCancel(file)) {
        return plan;
      }
      const dest = await p.select({
        message: "Move to which commit?",
        options: commitOptions(plan)
      });
      if (p.isCancel(dest)) {
        return plan;
      }
      return withMovedFile(plan, file, dest);
    });
  }

  private reorder(plan: SplitPlan): Future<Error, SplitPlan> {
    return Future.attemptP(async () => {
      const from = await p.select({
        message: "Which commit?",
        options: commitOptions(plan)
      });
      if (p.isCancel(from)) {
        return plan;
      }
      const position = await p.select({
        message: "New position",
        options: plan.commits.map((_, index) => ({ value: index + 1, label: String(index + 1) }))
      });
      if (p.isCancel(position)) {
        return plan;
      }
      return withReorderedCommit(plan, from, position - 1);
    });
  }

  private apply(plan: SplitPlan, meta: LlmRequestMetadata, shouldPush: boolean): Future<Error, void> {
    return Future.traverse(
      (group) =>
        repo.performCommit(group.message, group.files).map((stats) => {
          process.stdout.write(stats);
        }),
      [...plan.commits]
    ).chain(() =>
      shouldPush ?
        this.pushAfterCommit(Just(meta)).map(() => {
          p.outro(color.green("Done!"));
        })
      : repo.findCommitMetadata().map((commit) => {
          renderCommitNote({ commit, request: Just(meta) });
          p.outro(color.green("Committed successfully!"));
        })
    );
  }

  private push(request: Maybe<LlmRequestMetadata>, branch?: string, publish = false, forceWithLease = false): Future<Error, void> {
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
}
