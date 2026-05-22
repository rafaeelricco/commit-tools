import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/package.json", replacement: resolve(root, "package.json") },
      { find: /^@\/(.+)$/, replacement: resolve(root, "src/$1") }
    ]
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "index.ts"],
      exclude: ["**/*.test.ts", "dist/**"]
    }
  }
});
