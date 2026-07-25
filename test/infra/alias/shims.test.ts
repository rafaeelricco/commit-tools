import { afterEach, describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { aliasBinDir, findConflictingBinary, reconcileShims, removeShim, shimPath, writeShim } from "@/infra/alias/shims";
import { AliasName, type Alias } from "@/domain/alias/alias";
import { Failure } from "@/libs/result";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

const name = (raw: string): AliasName => {
  const parsed = AliasName.parse(raw);
  if (parsed instanceof Failure) throw new Error(`fixture name ${raw} is invalid`);
  return parsed.value;
};

const alias = (raw: string, target: Alias["target"] = "generate"): Alias => ({ name: name(raw), target });

const originalEntry = process.argv[1] ?? "";

afterEach(() => {
  process.argv[1] = originalEntry;
});

describe("writeShim", () => {
  it("creates an executable shim that runs the bound target", async () => {
    await runFuture(writeShim(alias("cb", "branch")));

    const path = shimPath(name("cb"));
    const contents = await readFile(path, "utf-8");

    expect(contents.startsWith("#!/bin/sh\n")).toBe(true);
    expect(contents).toContain(process.execPath);
    expect(contents).toContain(' branch "$@"');
    expect((await stat(path)).mode & 0o777).toBe(0o755);
  });

  it("quotes an entry path containing a quote or a dollar sign", async () => {
    process.argv[1] = "/tmp/we'ird/$path/index.js";
    await runFuture(writeShim(alias("cb")));

    const contents = await readFile(shimPath(name("cb")), "utf-8");
    expect(contents).toContain("'/tmp/we'\\''ird/$path/index.js'");
  });

  it("resets the mode when overwriting an existing shim", async () => {
    await runFuture(writeShim(alias("cb")));
    const { chmod } = await import("node:fs/promises");
    await chmod(shimPath(name("cb")), 0o600);

    await runFuture(writeShim(alias("cb")));
    expect((await stat(shimPath(name("cb")))).mode & 0o777).toBe(0o755);
  });
});

describe("removeShim", () => {
  it("deletes the shim", async () => {
    await runFuture(writeShim(alias("cb")));
    await runFuture(removeShim(name("cb")));
    expect(existsSync(shimPath(name("cb")))).toBe(false);
  });

  it("is a no-op when the shim is absent", async () => {
    await expect(runFuture(removeShim(name("ghost")))).resolves.toBeUndefined();
  });
});

describe("reconcileShims", () => {
  it("rewrites every registered shim", async () => {
    await runFuture(reconcileShims([alias("cb", "branch"), alias("cm", "generate")]));

    expect(await readFile(shimPath(name("cb")), "utf-8")).toContain(' branch "$@"');
    expect(await readFile(shimPath(name("cm")), "utf-8")).toContain(' generate "$@"');
  });
});

describe("findConflictingBinary", () => {
  it("finds an executable already on PATH", async () => {
    expect(await runFuture(findConflictingBinary(name("sh")))).toBeInstanceOf(Just);
  });

  it("ignores our own bin dir so an existing alias is not reported as a conflict", async () => {
    await runFuture(writeShim(alias("cb")));

    const previous = process.env["PATH"];
    process.env["PATH"] = aliasBinDir();
    try {
      expect(await runFuture(findConflictingBinary(name("cb")))).toBeInstanceOf(Nothing);
    } finally {
      process.env["PATH"] = previous;
    }
  });
});
