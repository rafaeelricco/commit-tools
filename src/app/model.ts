export { ModelCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { type Config, type ProviderConfig } from "@/app/services/config";
import { loadConfig, saveConfig, updateTokens } from "@/app/storage";
import { ensureFreshTokens } from "@/app/services/googleAuth";
import { fetchModels, selectModelInteractively } from "@/app/services/models";
import { Dependencies } from "@/app/integrations";
import { loading } from "@/app/spinner";

import color from "picocolors";

class ModelCommand {
  private constructor(
    private readonly config: Config,
    private readonly providerConfig: ProviderConfig
  ) {}

  static create(deps: Dependencies): Future<Error, ModelCommand> {
    return loadConfig()
      .chainRej(() =>
        Future.reject<Error, Config>(new Error("No configuration found. Run 'commit-tools setup' first."))
      )
      .chain((config) => ModelCommand.resolveProvider(deps, config).map((ai) => new ModelCommand(config, ai)));
  }

  run(): Future<Error, void> {
    p.intro(color.bgCyan(color.black(" Change Model ")));

    return loading("Fetching available models...", "Models fetched!", fetchModels(this.providerConfig.auth_method))
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

  private static resolveProvider(deps: Dependencies, config: Config): Future<Error, ProviderConfig> {
    const ai = config.ai;

    if (ai.provider === "gemini" && ai.auth_method.type === "oauth") {
      const originalTokens = ai.auth_method.content;

      return ensureFreshTokens(deps, originalTokens).chain((freshTokens) => {
        const tokensChanged =
          freshTokens.access_token !== originalTokens.access_token ||
          freshTokens.expiry_date !== originalTokens.expiry_date;

        const persist = tokensChanged ? updateTokens(freshTokens) : Future.resolve<Error, void>(undefined);

        return persist.map(
          (): ProviderConfig => ({
            provider: "gemini",
            model: ai.model,
            auth_method: { type: "oauth", content: freshTokens }
          })
        );
      });
    }

    return Future.resolve(ai);
  }
}
