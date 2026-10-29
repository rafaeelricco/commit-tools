import { describe, expect, it } from "vitest";
import { parseDiff, isTestPath } from "@/domain/context/diff";

const MODIFIED =
  "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@ export function a()\n ctx\n-old\n+new\n";
const ADDED =
  "diff --git a/src/b.ts b/src/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,2 @@\n+export const b = 1;\n+export const c = 2;\n";
const DELETED = "diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n";
const RENAMED = "diff --git a/x.ts b/y.ts\nsimilarity index 92%\nrename from x.ts\nrename to y.ts\n";
const BINARY = "diff --git a/logo.png b/logo.png\nnew file mode 100644\nBinary files /dev/null and b/logo.png differ\n";
const SPACED = "diff --git a/my file.ts b/my file.ts\n--- a/my file.ts\n+++ b/my file.ts\n@@ -1 +1 @@\n-a\n+b\n";

describe("parseDiff", () => {
  it("parses a modified file with hunks and counts", () => {
    const [file] = parseDiff(MODIFIED);
    expect(file).toMatchObject({ path: "src/a.ts", change: { tag: "modified" }, added: 1, deleted: 1, raw: MODIFIED });
    expect(file?.hunks).toEqual([{ header: "@@ -1,3 +1,3 @@ export function a()", lines: [" ctx", "-old", "+new"] }]);
  });

  it("tags added, deleted, renamed and binary files", () => {
    const files = parseDiff(ADDED + DELETED + RENAMED + BINARY);
    expect(files.map((f) => [f.path, f.change])).toEqual([
      ["src/b.ts", { tag: "added" }],
      ["old.ts", { tag: "deleted" }],
      ["y.ts", { tag: "renamed", from: "x.ts", similarity: 92 }],
      ["logo.png", { tag: "binary" }]
    ]);
  });

  it("keeps paths with spaces", () => {
    expect(parseDiff(SPACED)[0]?.path).toBe("my file.ts");
  });

  it("ignores text outside diff chunks", () => {
    expect(parseDiff("\n# Generated files changed but not shown:\npnpm-lock.yaml | +1 -0\n")).toEqual([]);
  });
});

describe("isTestPath", () => {
  it("matches test dirs and .test/.spec files only", () => {
    expect(["test/a.ts", "src/__tests__/b.ts", "src/c.test.ts", "d.spec.tsx"].every(isTestPath)).toBe(true);
    expect(["src/testing.ts", "src/latest.ts", "contest/x.ts"].some(isTestPath)).toBe(false);
  });
});
