/*
`commit fast-model`: pick the model `commit` uses for messages and split plans, or go back to the
main model. It uses the main model's provider and sign-in and runs at the provider's lowest effort
(src/cli/commit.ts). Branch names keep the main model. A cancelled prompt saves nothing.
*/
export { FastModelCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { type Config, type ProviderConfig } from "@/domain/config/config";
import { loadConfig, saveConfig } from "@/infra/storage/config";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import { fetchModels } from "@/domain/commit/models";
import { selectModelInteractively } from "@/infra/ui/model-picker";
import { loading } from "@/infra/ui/spinner";
import { Just, Nothing, type Maybe } from "@/libs/maybe";

import color from "picocolors";

class FastModelCommand {
  private constructor(
    private readonly config: Config,
    private readonly providerConfig: ProviderConfig
  ) {}

  static create(): Future<Error, FastModelCommand> {
    return loadConfig()
      .chainRej(() => Future.reject<Error, Config>(new Error("No configuration found. Run 'commit-tools setup' first.")))
      .chain((config) => resolveProvider(config).map((ai) => new FastModelCommand(config, ai)));
  }

  run(): Future<Error, void> {
    p.intro(color.bgCyan(color.black(" Fast Model ")));

    return this.chooseFastModel()
      .chain((fast_model) => saveConfig({ ...this.config, ai: this.providerConfig, fast_model }).map(() => fast_model))
      .map((fast_model) => p.outro(color.green(fast_model.maybe("Commit will use the main model.", (id) => `Commit will use ${id}.`))))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }

  private chooseFastModel(): Future<Error, Maybe<string>> {
    return Future.attemptP(() =>
      p.select({
        message: `Model for commit messages and split plans (now: ${this.config.fast_model.withDefault("the main model")})`,
        options: [
          { value: "pick" as const, label: "Pick a fast model" },
          { value: "main" as const, label: "Use the main model" }
        ]
      })
    ).chain((choice): Future<Error, Maybe<string>> => {
      if (p.isCancel(choice)) return Future.reject(new Error("Selection cancelled"));
      if (choice === "main") return Future.resolve(Nothing<string>());
      return loading("Fetching available models...", "Models fetched!", fetchModels(this.providerConfig.provider, this.providerConfig.auth_method))
        .chain((models) => selectModelInteractively(models))
        .map((model) => Just(model.id));
    });
  }
}
