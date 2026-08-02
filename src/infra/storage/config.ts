export { loadConfig, saveConfig, updateOAuthTokens, configDir, configFile };

import * as s from "@/libs/json/schema";

import { Future } from "@/libs/future";
import { Success, Failure, type Result } from "@/libs/result";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Config, resolveAuthMethod, type RefreshTokens } from "@/domain/config/config";

const configDir = (): string => (process.env["COMMIT_TOOLS_HOME"] ? resolve(process.env["COMMIT_TOOLS_HOME"]) : resolve(homedir(), ".commit-tools"));
const configFile = (): string => resolve(configDir(), "config.json");

const parseConfigJson = (raw: string, path: string): Result<Error, unknown> => {
  try {
    return Success(JSON.parse(raw));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return Failure(new Error(`Config file is not valid JSON (${path}): ${detail}. Fix the file or run 'commit setup' to recreate it.`));
  }
};

const loadConfig = (): Future<Error, Config> =>
  Future.attemptP(() => readFile(configFile(), "utf-8"))
    .mapRej((err) => new Error(`Failed to read config file: ${err}`))
    .chain((raw) => {
      const parsed = parseConfigJson(raw, configFile());
      return parsed.either(
        (err) => Future.reject(err),
        (json) => {
          const result = s.decode(Config, json);
          return result.either(
            (err) => Future.reject(new Error(`Invalid config: ${err}`)),
            (ok) => Future.resolve(ok)
          );
        }
      );
    });

const saveConfig = (config: Config): Future<Error, void> =>
  Future.attemptP(async () => {
    await mkdir(configDir(), { recursive: true });
    await writeFile(configFile(), JSON.stringify(s.encode(Config, config), null, 2), "utf-8");
  });

/** The auth variants whose `content` is a refreshable token pair. Widens on its own when a new one is added. */
type RefreshableAuthMethod = Extract<Config["ai"]["auth_method"], { content: RefreshTokens }>;

const updateOAuthTokens = (auth_method: RefreshableAuthMethod): Future<Error, void> =>
  loadConfig().chain((config) =>
    config.ai.auth_method.type === auth_method.type ?
      saveConfig({ ...config, ai: resolveAuthMethod(config.ai, auth_method) })
    : Future.reject<Error, void>(new Error(`Cannot update tokens: config is not using ${auth_method.type} authentication`))
  );
