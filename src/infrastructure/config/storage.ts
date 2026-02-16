import * as s from "@/json/schema";

import { Future } from "@/future";
import { resolve } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { Config, type OAuthTokens } from "@domain/config/schema";

export const CONFIG_DIR = resolve(homedir(), ".commit-tools");
export const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

/**
 * Loads the configuration from the home directory.
 */
export const loadConfig = (): Future<Error, Config> =>
  Future.attemptP(() => Bun.file(CONFIG_FILE).text())
    .mapRej(err => new Error(`Failed to read config file: ${err}`))
    .map((value) => JSON.parse(value))
    .chain(json => {
      const result = s.decode(Config, json);
      return result.either(
        err => Future.reject(new Error(`Invalid config: ${err}`)),
        ok => Future.resolve(ok)
      );
    });

/**
 * Saves the configuration to the home directory.
 */
export const saveConfig = (config: Config): Future<Error, void> =>
  Future.attemptP(async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(CONFIG_FILE, JSON.stringify(s.encode(Config, config), null, 2));
  });

/**
 * Persists refreshed OAuth tokens without rewriting the entire config.
 */
export const updateTokens = (tokens: OAuthTokens): Future<Error, void> =>
  loadConfig().chain(config => saveConfig({ ...config, tokens }));
