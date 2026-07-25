import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { aliasesFile, loadAliases, saveAliases } from "@/infra/storage/aliases";
import { AliasName, type Alias } from "@/domain/alias/alias";
import { Failure } from "@/libs/result";
import { runFuture } from "@test/helpers/run-future";

const alias = (raw: string, target: Alias["target"]): Alias => {
  const parsed = AliasName.parse(raw);
  if (parsed instanceof Failure) throw new Error(`fixture name ${raw} is invalid`);
  return { name: parsed.value, target };
};

const writeRaw = async (contents: string): Promise<void> => {
  await mkdir(dirname(aliasesFile()), { recursive: true });
  await writeFile(aliasesFile(), contents, "utf-8");
};

describe("alias storage", () => {
  it("treats a missing file as the empty registry", async () => {
    expect(await runFuture(loadAliases())).toEqual([]);
  });

  it("round-trips aliases through disk", async () => {
    await runFuture(saveAliases([alias("cb", "branch"), alias("cm", "generate")]));
    const loaded = await runFuture(loadAliases());

    expect(loaded.map((a) => [a.name.value, a.target])).toEqual([
      ["cb", "branch"],
      ["cm", "generate"]
    ]);
  });

  it("writes a readable object shape", async () => {
    await runFuture(saveAliases([alias("cb", "branch")]));
    const { readFile } = await import("node:fs/promises");
    expect(JSON.parse(await readFile(aliasesFile(), "utf-8"))).toEqual({ aliases: [{ name: "cb", target: "branch" }] });
  });

  it("rejects invalid JSON with a path-bearing message", async () => {
    await writeRaw("{ invalid");
    await expect(runFuture(loadAliases())).rejects.toThrow(/not valid JSON/);
    await expect(runFuture(loadAliases())).rejects.toThrow(aliasesFile());
  });

  it("rejects an unknown target", async () => {
    await writeRaw(JSON.stringify({ aliases: [{ name: "cb", target: "nope" }] }));
    await expect(runFuture(loadAliases())).rejects.toThrow(/Invalid aliases file/);
  });

  it("rejects a stored name that would escape the bin dir", async () => {
    await writeRaw(JSON.stringify({ aliases: [{ name: "../../evil", target: "generate" }] }));
    await expect(runFuture(loadAliases())).rejects.toThrow(/Invalid alias name/);
  });

  it("rejects duplicate names instead of silently keeping one", async () => {
    await writeRaw(
      JSON.stringify({
        aliases: [
          { name: "cb", target: "branch" },
          { name: "cb", target: "setup" }
        ]
      })
    );
    await expect(runFuture(loadAliases())).rejects.toThrow(/Duplicate alias names/);
  });
});
