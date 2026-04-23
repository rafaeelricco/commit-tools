export { loadConfig, saveConfig, updateGoogleTokens, updateOpenAITokens, CONFIG_DIR, CONFIG_FILE };

import * as s from "@/libs/json/schema";

import { Future } from "@/libs/future";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Config, type OAuthTokens, type OpenAITokens } from "@/domain/config/config";

const CONFIG_DIR = resolve(homedir(), ".commit-tools");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

const loadConfig = (): Future<Error, Config> =>
  Future.attemptP(() => readFile(CONFIG_FILE, "utf-8"))
    .mapRej((err) => new Error(`Failed to read config file: ${err}`))
    .map((value) => JSON.parse(value))
    .chain((json) => {
      const result = s.decode(Config, json);
      return result.either(
        (err) => Future.reject(new Error(`Invalid config: ${err}`)),
        (ok) => Future.resolve(ok)
      );
    });

const saveConfig = (config: Config): Future<Error, void> =>
  Future.attemptP(async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CONFIG_FILE, JSON.stringify(s.encode(Config, config), null, 2), "utf-8");
  });

const updateGoogleTokens = (tokens: OAuthTokens): Future<Error, void> =>
  loadConfig().chain((config) => {
    // TODO: Why we are doing this?
    if (config.ai.provider !== "gemini" || config.ai.auth_method.type !== "google_oauth") {
      return Future.reject<Error, void>(new Error("Cannot update tokens: not using Google OAuth authentication"));
    }
    return saveConfig({
      ...config,
      ai: {
        provider: "gemini",
        model: config.ai.model,
        auth_method: { type: "google_oauth", content: tokens },
        effort: config.ai.effort
      }
    });
  });

const updateOpenAITokens = (tokens: OpenAITokens): Future<Error, void> =>
  loadConfig().chain((config) => {
    // TODO: Why we are doing this?
    if (config.ai.provider !== "openai" || config.ai.auth_method.type !== "openai_oauth") {
      return Future.reject<Error, void>(new Error("Cannot update tokens: not using OpenAI OAuth authentication"));
    }
    return saveConfig({
      ...config,
      ai: {
        provider: "openai",
        model: config.ai.model,
        auth_method: { type: "openai_oauth", content: tokens },
        effort: config.ai.effort
      }
    });
  });
