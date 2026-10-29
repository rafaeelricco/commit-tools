import { describe, expect, it } from "vitest";
import { buildStagedContext } from "@/domain/context/context";

const chunk = (path: string, n: number): string =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${n} +1,${n} @@\n` +
  Array.from({ length: n }, (_, i) => ` ctx ${i}\n-old ${i}\n+new ${i}\n`).join("");
const NOTE = "\n# Generated files changed but not shown:\npnpm-lock.yaml | +2 -0 (generated, body omitted)\n";
const snapshot = (diff: string) => ({ diff, generatedNote: NOTE, importLines: "", history: "" });

describe("buildStagedContext", () => {
  it("sends today's exact text when under budget", () => {
    const diff = chunk("src/a.ts", 2);
    const ctx = buildStagedContext(snapshot(diff), ["src/a.ts", "pnpm-lock.yaml"]);
    expect(ctx.diff).toBe(diff + NOTE);
    expect(ctx.size.tag).toBe("whole");
    expect(ctx.manifest).toBe("M src/a.ts +2 -2" + NOTE);
  });

  it("compresses to the budget and lists every file in the manifest", () => {
    const diff = chunk("src/a.ts", 400) + chunk("test/a.test.ts", 400);
    const ctx = buildStagedContext(snapshot(diff), ["src/a.ts", "test/a.test.ts", "pnpm-lock.yaml"], 2_000);
    expect(ctx.size).toMatchObject({ tag: "compressed" });
    expect(ctx.diff.length / 4).toBeLessThanOrEqual(2_000);
    expect(ctx.diff).toContain("# Files\nM src/a.ts +400 -400\nM test/a.test.ts +400 -400");
    expect(ctx.diff).toContain("pnpm-lock.yaml | +2 -0");
    expect(ctx.hints).toEqual([{ files: ["src/a.ts", "test/a.test.ts"], reasons: ["test"] }]);
  });
});
