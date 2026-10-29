import { describe, expect, it } from "vitest";
import { parseDiff } from "@/domain/context/diff";
import { Detail, dedupeUnits, fitToBudget, renderUnit, statLine } from "@/domain/context/compress";

const modified = (path: string, body: string): string =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,4 +1,4 @@ class Box\n ctx\n${body} ctx2\n`;
const added = (path: string, lines: number): string =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines} @@\n` +
  Array.from({ length: lines }, (_, i) => (i === 30 ? "+export function late() {}\n" : `+line ${i}\n`)).join("");

describe("statLine", () => {
  it("formats each change kind", () => {
    const files = parseDiff(modified("src/a.ts", "-old\n+new\n") + added("src/b.ts", 3));
    expect(files.map(statLine)).toEqual(["M src/a.ts +1 -1", "A src/b.ts (new, 3 lines)"]);
  });
});

describe("renderUnit", () => {
  const [file] = parseDiff(modified("src/a.ts", "-old\n+export const x = 1;\n+plain\n"));
  const unit = { files: file ? [file] : [] };

  it("full is git's text", () => {
    expect(renderUnit(unit, Detail.Full)).toBe(file?.raw);
  });

  it("changes drops context lines but keeps hunk headers", () => {
    const text = renderUnit(unit, Detail.Changes);
    expect(text).toContain("@@ -1,4 +1,4 @@ class Box");
    expect(text).toContain("+plain");
    expect(text).not.toContain(" ctx");
  });

  it("outline keeps declarations only", () => {
    const text = renderUnit(unit, Detail.Outline);
    expect(text).toContain("M src/a.ts");
    expect(text).toContain("+export const x = 1;");
    expect(text).not.toContain("+plain");
  });

  it("outline drops hunks without declarations, header included", () => {
    const [plain] = parseDiff(modified("src/p.ts", "-a\n+b\n"));
    expect(renderUnit({ files: plain ? [plain] : [] }, Detail.Outline)).toBe("M src/p.ts +1 -1");
  });

  it("outline of a test file keeps test names", () => {
    const [t] = parseDiff(modified("test/a.test.ts", '+  it("adds", () => {\n+    expect(1).toBe(1);\n'));
    const text = renderUnit({ files: t ? [t] : [] }, Detail.Outline);
    expect(text).toContain('it("adds"');
    expect(text).not.toContain("expect(1)");
  });

  it("changes on a new file previews the head, then declarations", () => {
    const [n] = parseDiff(added("src/n.ts", 40));
    const text = renderUnit({ files: n ? [n] : [] }, Detail.Changes);
    expect(text).toContain("+line 19");
    expect(text).not.toContain("+line 25");
    expect(text).toContain("+export function late() {}");
  });
});

describe("dedupeUnits", () => {
  it("folds identical edits into one unit", () => {
    const files = parseDiff(modified("a.ts", "-foo(\n+bar(\n") + modified("b.ts", "-foo(\n+bar(\n") + modified("c.ts", "-x\n+y\n"));
    const units = dedupeUnits(files);
    expect(units.map((u) => u.files.map((f) => f.path))).toEqual([["a.ts", "b.ts"], ["c.ts"]]);
    expect(renderUnit(units[0] ?? { files: [] }, Detail.Changes)).toContain("# Same change in 2 files: a.ts, b.ts");
  });
});

describe("fitToBudget", () => {
  const units = dedupeUnits(parseDiff(modified("src/big.ts", "+".repeat(400) + "\n") + modified("test/t.test.ts", "+z\n")));

  it("keeps everything full when it fits", () => {
    expect(fitToBudget(units, 10_000)).toEqual([Detail.Full, Detail.Full]);
  });

  it("degrades test files before larger source files", () => {
    const budget =
      renderUnit(units[0] ?? { files: [] }, Detail.Full).length + renderUnit(units[1] ?? { files: [] }, Detail.Changes).length + units.length; // + one "\n" separator per unit
    expect(fitToBudget(units, budget)).toEqual([Detail.Full, Detail.Changes]);
  });

  it("falls to stat for everything when the budget is tiny", () => {
    expect(fitToBudget(units, 1)).toEqual([Detail.Stat, Detail.Stat]);
  });
});
