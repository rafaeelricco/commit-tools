import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load .env file if present and parse KEY=VALUE pairs */
const loadEnv = (): Record<string, string> => {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return env;
  } catch {
    return {};
  }
};

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  minify: true,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  shims: true,
  esbuildOptions(options) {
    const fileEnv = loadEnv();
    const clientId = process.env["GOOGLE_CLIENT_ID"] ?? fileEnv["GOOGLE_CLIENT_ID"];
    const clientSecret = process.env["GOOGLE_CLIENT_SECRET"] ?? fileEnv["GOOGLE_CLIENT_SECRET"];

    if (clientId) {
      options.define = {
        ...options.define,
        "process.env.GOOGLE_CLIENT_ID": JSON.stringify(clientId),
        "process.env.GOOGLE_CLIENT_SECRET": JSON.stringify(clientSecret ?? "")
      };
    }
  }
});
