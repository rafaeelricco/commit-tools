export { EffortCommand };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";
import { type Config } from "@/domain/config/config";
import { loadConfig, saveConfig } from "@/infra/storage/config";
import { selectEffortForProvider } from "@/domain/llm/effort";

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

    return selectEffortForProvider(this.config.ai)
      .chain((ai) => saveConfig({ ...this.config, ai }))
      .map(() => p.outro(color.green("Effort updated successfully!")))
      .mapRej((e) => {
        p.log.error(color.red(e.message));
        return e;
      });
  }
}
