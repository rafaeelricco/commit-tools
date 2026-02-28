export { ModelCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { type Config, type ProviderConfig } from "@/app/services/config";
import { loadConfig, saveConfig } from "@/app/storage";
import { resolveProvider } from "@/app/services/resolveProvider";
import { fetchModels, selectModelInteractively } from "@/app/services/models";
import { loading } from "@/app/spinner";

import color from "picocolors";

class ModelCommand {
  private constructor(
    private readonly config: Config,
    private readonly providerConfig: ProviderConfig
  ) {}

  static create(): Future<Error, ModelCommand> {
    return loadConfig()
      .chainRej(() =>
        Future.reject<Error, Config>(new Error("No configuration found. Run 'commit-tools setup' first."))
      )
      .chain((config) => resolveProvider(config).map((ai) => new ModelCommand(config, ai)));
  }

  run(): Future<Error, void> {
    p.intro(color.bgCyan(color.black(" Change Model ")));

    return loading(
      "Fetching available models...",
      "Models fetched!",
      fetchModels(this.providerConfig.provider, this.providerConfig.auth_method)
    )
      .chain((models) => selectModelInteractively(models))
      .chain((modelId) =>
        saveConfig({
          ...this.config,
          ai: { ...this.config.ai, model: modelId }
        })
      )
      .map(() => {
        p.outro(color.green("Model updated successfully!"));
      })
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }
}
