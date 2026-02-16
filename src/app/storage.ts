export { loadConfig, saveConfig, updateTokens, CONFIG_DIR, CONFIG_FILE };

import * as s from "@/libs/json/schema";

import { Future } from "@/libs/future";
import { resolve } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";
import { Config, type OAuthTokens } from "@/app/services/googleAuth";

const CONFIG_DIR = resolve(homedir(), ".commit-tools");
const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");

const loadConfig = (): Future<Error, Config> =>
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

const saveConfig = (config: Config): Future<Error, void> =>
  Future.attemptP(async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
    await Bun.write(CONFIG_FILE, JSON.stringify(s.encode(Config, config), null, 2));
  });

const updateTokens = (tokens: OAuthTokens): Future<Error, void> =>
  loadConfig().chain(config => saveConfig({ ...config, tokens }));
