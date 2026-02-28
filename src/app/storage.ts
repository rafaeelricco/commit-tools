export { loadConfig, saveConfig, updateGoogleTokens, updateOpenAITokens, CONFIG_DIR, CONFIG_FILE };

import * as s from "@/libs/json/schema";

import { Future } from "@/libs/future";
import { resolve } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { Config, type OAuthTokens, type OpenAITokens } from "@/app/services/config";
import { Just, Nothing, type Maybe } from "@/libs/maybe";

const CONFIG_DIR = resolve(homedir(), ".commit-tools");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

const loadConfig = (): Future<Error, Config> =>
  Future.attemptP(() => Bun.file(CONFIG_FILE).text())
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
    await Bun.write(CONFIG_FILE, JSON.stringify(s.encode(Config, config), null, 2));
  });

const extractGoogleOAuthConfig = (config: Config): Maybe<{ model: string }> =>
  config.ai.provider === "gemini" && config.ai.auth_method.type === "google_oauth" ?
    Just({ model: config.ai.model })
  : Nothing();

const extractOpenAIOAuthConfig = (config: Config): Maybe<{ model: string }> =>
  config.ai.provider === "openai" && config.ai.auth_method.type === "openai_oauth" ?
    Just({ model: config.ai.model })
  : Nothing();

const updateGoogleTokens = (tokens: OAuthTokens): Future<Error, void> =>
  loadConfig().chain((config) =>
    extractGoogleOAuthConfig(config).maybe(
      Future.reject<Error, void>(new Error("Cannot update tokens: not using Google OAuth authentication")),
      ({ model }) =>
        saveConfig({
          ...config,
          ai: { provider: "gemini", model, auth_method: { type: "google_oauth", content: tokens } }
        })
    )
  );

const updateOpenAITokens = (tokens: OpenAITokens): Future<Error, void> =>
  loadConfig().chain((config) =>
    extractOpenAIOAuthConfig(config).maybe(
      Future.reject<Error, void>(new Error("Cannot update tokens: not using OpenAI OAuth authentication")),
      ({ model }) =>
        saveConfig({
          ...config,
          ai: { provider: "openai", model, auth_method: { type: "openai_oauth", content: tokens } }
        })
    )
  );
