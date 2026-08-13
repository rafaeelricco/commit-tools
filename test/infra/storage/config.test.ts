import { describe, expect, it, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { loadConfig, saveConfig, updateOAuthTokens, configFile } from "@/infra/storage/config";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";
import * as s from "@/libs/json/schema";
import { Config } from "@/domain/config/config";

type ConfigValue = s.Infer<typeof Config>;

const sampleConfig = (): ConfigValue => ({
  commit_convention: "conventional",
  custom_template: Nothing(),
  split_commits: false,
  ai: {
    provider: "openai",
    model: "gpt-4.1-mini",
    effort: Nothing(),
    auth_method: { type: "api_key", content: "sk-test" }
  }
});

const staleTokens = () => ({ access_token: "stale", refresh_token: "r1", expiry_date: 1 });

describe("config storage", () => {
  beforeEach(async () => {
    await runFuture(saveConfig(sampleConfig()));
  });

  it("writes and reads config.json", async () => {
    const loaded = await runFuture(loadConfig());
    expect(loaded.ai.provider).toBe("openai");
    const raw = await readFile(configFile(), "utf-8");
    expect(JSON.parse(raw).ai.provider).toBe("openai");
  });

  it("updateOAuthTokens persists new tokens when the config uses that auth method", async () => {
    await runFuture(saveConfig({ ...sampleConfig(), ai: { ...sampleConfig().ai, auth_method: { type: "openai_oauth", content: staleTokens() } } }));

    await runFuture(updateOAuthTokens({ type: "openai_oauth", content: { access_token: "fresh", refresh_token: "r2", expiry_date: 2 } }));

    const loaded = await runFuture(loadConfig());
    if (loaded.ai.auth_method.type !== "openai_oauth") throw new Error("expected openai_oauth");
    expect(loaded.ai.auth_method.content.access_token).toBe("fresh");
    expect(loaded.ai.auth_method.content.expiry_date).toBe(2);
  });

  it("updateOAuthTokens rejects when the config uses a different auth method", async () => {
    await expect(runFuture(updateOAuthTokens({ type: "openai_oauth", content: staleTokens() }))).rejects.toThrow(/not using openai_oauth/);
  });

  it("updateOAuthTokens leaves sibling config fields untouched", async () => {
    await runFuture(
      saveConfig({
        commit_convention: "imperative",
        custom_template: Just("tpl"),
        split_commits: false,
        ai: { ...sampleConfig().ai, auth_method: { type: "openai_oauth", content: staleTokens() } }
      })
    );

    await runFuture(updateOAuthTokens({ type: "openai_oauth", content: { access_token: "fresh", refresh_token: "r2", expiry_date: 2 } }));

    const loaded = await runFuture(loadConfig());
    expect(loaded.commit_convention).toBe("imperative");
    expect(loaded.custom_template).toBeInstanceOf(Just);
    expect(loaded.ai.model).toBe("gpt-4.1-mini");
  });

  it("rejects invalid JSON on load with a clear error", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(configFile()), { recursive: true });
    await writeFile(configFile(), "{ invalid", "utf-8");
    await expect(runFuture(loadConfig())).rejects.toThrow(/not valid JSON/);
    await expect(runFuture(loadConfig())).rejects.toThrow(configFile());
    await expect(runFuture(loadConfig())).rejects.toThrow(/commit setup/);
  });
});
