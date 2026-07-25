import { beforeEach, describe, expect, it, vi } from "vitest";
import { Future } from "@/libs/future";
import { Nothing } from "@/libs/maybe";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() }
}));

vi.mock("@/infra/storage/aliases", () => ({
  loadAliases: vi.fn(),
  saveAliases: vi.fn(() => Future.resolve(undefined))
}));

vi.mock("@/infra/alias/shims", () => ({
  aliasBinDir: vi.fn(() => "/home/dev/.commit-tools/bin"),
  shimPath: vi.fn((name: { value: string }) => `/home/dev/.commit-tools/bin/${name.value}`),
  writeShim: vi.fn(() => Future.resolve(undefined)),
  removeShim: vi.fn(() => Future.resolve(undefined)),
  reconcileShims: vi.fn(() => Future.resolve(undefined)),
  findConflictingBinary: vi.fn(() => Future.resolve(Nothing()))
}));

vi.mock("@/infra/alias/path-setup", () => ({
  detectProfile: vi.fn(() => Nothing()),
  ensureBinDirOnPath: vi.fn(() => Future.resolve("added")),
  isBinDirOnPath: vi.fn(() => true),
  pathExportLine: vi.fn(() => "export PATH=...")
}));

import * as p from "@clack/prompts";
import { AliasCommand } from "@/cli/alias";
import { AliasName, type Alias } from "@/domain/alias/alias";
import { Failure } from "@/libs/result";
import { loadAliases, saveAliases } from "@/infra/storage/aliases";
import { reconcileShims, removeShim, writeShim } from "@/infra/alias/shims";
import { runFuture } from "@test/helpers/run-future";

const alias = (raw: string, target: Alias["target"]): Alias => {
  const parsed = AliasName.parse(raw);
  if (parsed instanceof Failure) throw new Error(`fixture name ${raw} is invalid`);
  return { name: parsed.value, target };
};

const withRegistry = (aliases: readonly Alias[]): void => {
  vi.mocked(loadAliases).mockReturnValue(Future.resolve(aliases));
};

const run = (action: Parameters<typeof AliasCommand.create>[0]) => runFuture(AliasCommand.create(action).chain((c) => c.run()));

beforeEach(() => {
  vi.clearAllMocks();
  withRegistry([]);
});

describe("alias list", () => {
  it("stays read-only — it writes no shims", async () => {
    withRegistry([alias("cb", "branch")]);
    await run({ type: "list" });

    expect(writeShim).not.toHaveBeenCalled();
    expect(reconcileShims).not.toHaveBeenCalled();
    expect(saveAliases).not.toHaveBeenCalled();
  });
});

describe("alias add", () => {
  it("writes the shim and persists the registry", async () => {
    await run({ type: "add", name: "cb", target: "branch" });

    expect(reconcileShims).toHaveBeenCalledWith([]);
    expect(vi.mocked(writeShim).mock.calls[0]?.[0]).toMatchObject({ target: "branch" });
    expect(vi.mocked(saveAliases).mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("reconciles existing shims before writing the new one", async () => {
    withRegistry([alias("cm", "generate")]);
    await run({ type: "add", name: "cb", target: "branch" });

    expect(reconcileShims).toHaveBeenCalledWith([expect.objectContaining({ target: "generate" })]);
    expect(vi.mocked(writeShim).mock.calls[0]?.[0]).toMatchObject({ target: "branch" });
  });

  it("rejects a duplicate without touching the filesystem", async () => {
    withRegistry([alias("cb", "branch")]);
    await expect(run({ type: "add", name: "cb", target: "setup" })).rejects.toThrow(/already exists/);

    expect(reconcileShims).toHaveBeenCalledWith([expect.objectContaining({ target: "branch" })]);
    expect(writeShim).not.toHaveBeenCalled();
    expect(saveAliases).not.toHaveBeenCalled();
  });

  it("rejects an unsafe name before it reaches a filesystem path", async () => {
    await expect(run({ type: "add", name: "../../evil", target: "generate" })).rejects.toThrow(/letters, digits/);
    expect(writeShim).not.toHaveBeenCalled();
  });

  it("rejects a reserved name", async () => {
    await expect(run({ type: "add", name: "commit", target: "generate" })).rejects.toThrow(/reserved/);
  });
});

describe("alias remove", () => {
  it("deletes the shim and persists the registry", async () => {
    withRegistry([alias("cb", "branch"), alias("cm", "generate")]);
    await run({ type: "remove", name: "cb" });

    expect(vi.mocked(removeShim).mock.calls[0]?.[0]).toMatchObject({ value: "cb" });
    expect(vi.mocked(saveAliases).mock.calls[0]?.[0]?.map((a) => a.name.value)).toEqual(["cm"]);
  });

  it("fails loudly on an unknown name", async () => {
    withRegistry([alias("cb", "branch")]);
    await expect(run({ type: "remove", name: "ghost" })).rejects.toThrow(/No alias named 'ghost'/);

    expect(removeShim).not.toHaveBeenCalled();
    expect(saveAliases).not.toHaveBeenCalled();
  });

  it("fails loudly when the registry is empty rather than reporting nothing to do", async () => {
    withRegistry([]);
    await expect(run({ type: "remove", name: "cb" })).rejects.toThrow(/No alias named 'cb'/);
  });
});

describe("alias create load failures", () => {
  it("logs the storage error when the registry cannot load", async () => {
    vi.mocked(loadAliases).mockReturnValue(Future.reject(new Error("Aliases file is not valid JSON")));

    await expect(run({ type: "list" })).rejects.toThrow(/not valid JSON/);
    expect(p.log.error).toHaveBeenCalled();
  });
});
