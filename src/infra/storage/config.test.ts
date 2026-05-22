import { describe, expect, it, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { loadConfig, saveConfig, CONFIG_FILE } from "@/infra/storage/config";
import { Nothing } from "@/libs/maybe";
import { runFuture } from "../../../test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

const sampleConfig = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  ai: {
    provider: "openai",
    model: "gpt-4.1-mini",
    effort: Nothing(),
    auth_method: { type: "api_key", content: "sk-test" }
  }
});

describe("config storage", () => {
  beforeEach(async () => {
    await runFuture(saveConfig(sampleConfig()));
  });

  it("writes and reads config.json", async () => {
    const loaded = await runFuture(loadConfig());
    expect(loaded.ai.provider).toBe("openai");
    const raw = await readFile(CONFIG_FILE, "utf-8");
    expect(JSON.parse(raw).ai.provider).toBe("openai");
  });

  it("rejects invalid JSON on load with a clear error", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(CONFIG_FILE), { recursive: true });
    await writeFile(CONFIG_FILE, "{ invalid", "utf-8");
    await expect(runFuture(loadConfig())).rejects.toThrow(/not valid JSON/);
    await expect(runFuture(loadConfig())).rejects.toThrow(CONFIG_FILE);
    await expect(runFuture(loadConfig())).rejects.toThrow(/commit setup/);
  });
});
