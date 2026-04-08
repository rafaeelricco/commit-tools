export { isLlmDebugEnabled, debugLog, debugError };

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let cachedEnvFlag: boolean | undefined;
let envLoaded = false;

const parseFlag = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized === "1") return true;
  if (normalized === "0") return false;
  return undefined;
};

const loadDotEnvFlag = (): boolean | undefined => {
  if (envLoaded) return cachedEnvFlag;
  envLoaded = true;

  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;

      const key = trimmed.slice(0, eq).trim();
      if (key !== "COMMIT_DEBUG_LLM") continue;

      cachedEnvFlag = parseFlag(trimmed.slice(eq + 1));
      break;
    }
  } catch {
    cachedEnvFlag = undefined;
  }

  return cachedEnvFlag;
};

const isLlmDebugEnabled = (): boolean => {
  const runtime = parseFlag(process.env["COMMIT_DEBUG_LLM"]);
  if (runtime !== undefined) return runtime;
  return loadDotEnvFlag() ?? false;
};

const shouldRedact = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("token") ||
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("authorization")
  );
};

const toSerializable = (value: unknown): unknown => {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  return value;
};

const safeSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(
      toSerializable(value),
      (key, current) => {
        if (shouldRedact(key) && typeof current === "string") return "[REDACTED]";
        if (typeof current === "bigint") return current.toString();
        return toSerializable(current);
      },
      2
    );
  } catch (error) {
    return `[unserializable payload: ${String(error)}]`;
  }
};

const debugLog = (scope: string, payload?: unknown): void => {
  if (!isLlmDebugEnabled()) return;

  if (payload === undefined) {
    console.log(`[commit-debug][${scope}]`);
    return;
  }

  if (typeof payload === "string") {
    console.log(`[commit-debug][${scope}] ${payload}`);
    return;
  }

  console.log(`[commit-debug][${scope}] ${safeSerialize(payload)}`);
};

const debugError = (scope: string, error: unknown): void => {
  if (!isLlmDebugEnabled()) return;
  debugLog(scope, toSerializable(error));
};
