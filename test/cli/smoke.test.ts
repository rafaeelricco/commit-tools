import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const BIN = resolve(import.meta.dirname, "../../dist/index.js");

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      COMMIT_TOOLS_HOME: process.env["COMMIT_TOOLS_HOME"],
      NO_UPDATE_NOTIFIER: "true",
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret"
    }
  });

const distExists = () => existsSync(BIN);

describe("CLI smoke (built dist)", () => {
  it.skipIf(!distExists())("-v prints version", () => {
    const { status, stdout } = runCli(["-v"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.skipIf(!distExists())("-h prints usage", () => {
    const { status, stdout } = runCli(["-h"]);
    expect(status).toBe(0);
    expect(stdout).toContain("generate");
  });

  it.skipIf(!distExists())("doctor exits 0", () => {
    const { status } = runCli(["doctor"]);
    expect(status).toBe(0);
  });

  it.skipIf(!distExists())("unknown command exits 1", () => {
    const { status, stderr } = runCli(["nope"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});
