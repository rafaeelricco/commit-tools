export { EffortCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { type Config } from "@/domain/config/config";
import { loadConfig, saveConfig } from "@/infra/storage/config";
import { selectEffortForProvider } from "@/domain/llm/effort";
import { resolveProvider } from "@/domain/llm/auth-resolver";
import { fetchModels } from "@/domain/commit/models";
import { loading } from "@/infra/ui/spinner";
import { fromOptional } from "@/libs/maybe";

import color from "picocolors";

class EffortCommand {
  private constructor(private readonly config: Config) {}

  static create(): Future<Error, EffortCommand> {
    return loadConfig()
      .chainRej(() => Future.reject<Error, Config>(new Error("No configuration found. Run 'commit-tools setup' first.")))
      .map((config) => new EffortCommand(config));
  }

  run(): Future<Error, void> {
    p.intro(color.bgCyan(color.black(" Change Effort ")));

    const selection =
      this.config.ai.provider === "openai" && this.config.ai.auth_method.type === "openai_oauth" ?
        resolveProvider(this.config).chain((current) =>
          loading("Fetching model capabilities...", "Model capabilities fetched!", fetchModels(current.provider, current.auth_method)).chain((models) =>
            selectEffortForProvider(
              current,
              fromOptional(models.find((model) => model.id === current.model)).chain((model) => model.openaiEffort)
            )
          )
        )
      : selectEffortForProvider(this.config.ai);

    return selection
      .chain((ai) => saveConfig({ ...this.config, ai }))
      .map(() => p.outro(color.green("Effort updated successfully!")))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }
}
