import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Guards the real ~/.zshrc: every profile path is resolved against this fake home.
const fakeHome = { path: "" };
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome.path };
});

import { detectProfile, ensureBinDirOnPath, isBinDirOnPath, pathExportLine, type ShellProfile } from "@/infra/alias/path-setup";
import { aliasBinDir } from "@/infra/alias/shims";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

beforeEach(() => {
  fakeHome.path = mkdtempSync(join(tmpdir(), "commit-tools-home-"));
});

const profile = (shell: ShellProfile["shell"]): ShellProfile => ({ shell, file: join(fakeHome.path, `.${shell}rc`) });

describe("detectProfile", () => {
  it.each([
    ["/bin/zsh", "zsh"],
    ["/usr/local/bin/bash", "bash"],
    ["/opt/homebrew/bin/fish", "fish"]
  ])("maps %s to %s", (shellPath, shell) => {
    process.env["SHELL"] = shellPath;
    const detected = detectProfile();
    expect(detected instanceof Just && detected.value.shell).toBe(shell);
  });

  it("is Nothing for an unrecognised shell", () => {
    process.env["SHELL"] = "/bin/ksh";
    expect(detectProfile()).toBeInstanceOf(Nothing);
  });
});

describe("pathExportLine", () => {
  it("uses fish_add_path for fish and an export for posix shells", () => {
    expect(pathExportLine("fish")).toBe(`fish_add_path ${aliasBinDir()}`);
    expect(pathExportLine("zsh")).toBe(`export PATH="${aliasBinDir()}:$PATH"`);
  });
});

describe("isBinDirOnPath", () => {
  it("detects the bin dir regardless of trailing separators", () => {
    const previous = process.env["PATH"];
    try {
      process.env["PATH"] = `/usr/bin:${aliasBinDir()}/`;
      expect(isBinDirOnPath()).toBe(true);
      process.env["PATH"] = "/usr/bin";
      expect(isBinDirOnPath()).toBe(false);
    } finally {
      process.env["PATH"] = previous;
    }
  });
});

describe("ensureBinDirOnPath", () => {
  it("creates the profile with a managed block when it does not exist", async () => {
    const target = profile("zsh");
    expect(await runFuture(ensureBinDirOnPath(target))).toBe("added");

    const contents = await readFile(target.file, "utf-8");
    expect(contents).toContain("# >>> commit-tools >>>");
    expect(contents).toContain(pathExportLine("zsh"));
    expect(contents).toContain("# <<< commit-tools <<<");
  });

  it("preserves existing content", async () => {
    const target = profile("zsh");
    await writeFile(target.file, "export EDITOR=vim\n", "utf-8");
    await runFuture(ensureBinDirOnPath(target));

    expect(await readFile(target.file, "utf-8")).toContain("export EDITOR=vim");
  });

  it("is idempotent — a second run leaves the file byte-identical", async () => {
    const target = profile("zsh");
    await runFuture(ensureBinDirOnPath(target));
    const afterFirst = await readFile(target.file, "utf-8");

    expect(await runFuture(ensureBinDirOnPath(target))).toBe("already-present");
    expect(await readFile(target.file, "utf-8")).toBe(afterFirst);
  });

  it("creates missing parent directories for nested profiles (fish)", async () => {
    const target: ShellProfile = {
      shell: "fish",
      file: join(fakeHome.path, ".config", "fish", "config.fish")
    };
    expect(await runFuture(ensureBinDirOnPath(target))).toBe("added");
    const contents = await readFile(target.file, "utf-8");
    expect(contents).toContain("fish_add_path");
    expect(contents).toContain("# >>> commit-tools >>>");
  });
});
