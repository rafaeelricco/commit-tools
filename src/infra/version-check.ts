export { checkForUpdate, compareVersions };

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_DIR } from "@/infra/storage/config";
import { Just, Nothing, type Maybe } from "@/libs/maybe";

const CACHE_FILE = resolve(CONFIG_DIR, "version-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://registry.npmjs.org/@rafaeelricco/commit-tools/latest";

type CachedCheck = { checkedAt: number; latestVersion: string };

const loadCache = (): Maybe<CachedCheck> => {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.checkedAt === "number" && typeof parsed?.latestVersion === "string") {
      return Just({ checkedAt: parsed.checkedAt, latestVersion: parsed.latestVersion });
    }
    return Nothing();
  } catch {
    return Nothing();
  }
};

const compareVersions = (a: string, b: string): number => {
  const parse = (v: string): number[] => (v.split("-")[0] ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
};

const refreshCacheInBackground = (): void => {
  const script = [
    `fetch(${JSON.stringify(REGISTRY_URL)})`,
    `.then(r => r.ok ? r.json() : Promise.reject())`,
    `.then(j => require("fs").writeFileSync(${JSON.stringify(CACHE_FILE)},`,
    `JSON.stringify({ checkedAt: Date.now(), latestVersion: j.version })))`,
    `.catch(() => {});`
  ].join("");
  try {
    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    child.on("error", () => {});
  } catch {
    // best-effort; never let a refresh failure surface
  }
};

const checkForUpdate = (): Maybe<string> => {
  const cached = loadCache();
  const isStale = cached.maybe(true, (c) => Date.now() - c.checkedAt > CHECK_INTERVAL_MS);
  if (isStale) refreshCacheInBackground();
  return cached.map((c) => c.latestVersion);
};
