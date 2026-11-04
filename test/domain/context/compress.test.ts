import { describe, expect, it } from "vitest";
import { parseDiff } from "@/domain/context/diff";
import { Detail, dedupeUnits, fairShares, fitToBudget, renderUnit, renderWithinBudget, statLine } from "@/domain/context/compress";

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

describe("fairShares", () => {
  it("gives small items all they need and splits the rest", () => {
    expect(fairShares([10, 100, 100], 110)).toEqual([10, 50, 50]);
  });

  it("leaves the remainder unspent when everything fits", () => {
    expect(fairShares([10, 20], 100)).toEqual([10, 20]);
  });
});

describe("renderWithinBudget", () => {
  const hunk = (start: number, lines: number, prefix: string): string =>
    `@@ -${start},${lines} +${start},${lines} @@\n` +
    Array.from({ length: lines }, (_, i) => `+${prefix} line ${i} of prose with no declaration\n`).join("");
  const markdown = (path: string, hunks: string): string => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunks}`;
  const total = (texts: readonly string[]): number => texts.filter((t) => t !== "").reduce((n, t) => n + t.length + 1, 0);

  it("keeps real content from an oversized Markdown file and marks the cut", () => {
    const units = dedupeUnits(parseDiff(markdown("docs/a.md", hunk(1, 2000, "alpha"))));
    const [text = ""] = renderWithinBudget(units, 8_000);
    expect(text).toContain("+alpha line 0");
    expect(text).toMatch(/# \.\.\. \d+ more changed lines cut/);
    expect(text.length).toBeGreaterThan(7_000);
    expect(text.length).toBeLessThanOrEqual(8_000);
  });

  it("represents every hunk of a truncated file", () => {
    const units = dedupeUnits(parseDiff(markdown("docs/a.md", hunk(1, 1000, "alpha") + hunk(5000, 1000, "omega"))));
    const [text = ""] = renderWithinBudget(units, 8_000);
    expect(text).toContain("+alpha line 0");
    expect(text).toContain("+omega line 0");
  });

  it("serves source files before tests", () => {
    const units = dedupeUnits(parseDiff(markdown("src/a.md", hunk(1, 2000, "alpha")) + markdown("test/a.test.ts", hunk(1, 2000, "omega"))));
    const texts = renderWithinBudget(units, 8_000);
    expect(texts[0]).toContain("+alpha line 0");
    expect(texts[1] ?? "").not.toContain("+omega line 0");
  });

  it("restores a new file past its preview when budget allows", () => {
    const units = dedupeUnits(parseDiff(added("src/n.ts", 40) + markdown("src/big.md", hunk(1, 2000, "alpha"))));
    const [text = ""] = renderWithinBudget(units, 40_000);
    expect(text).toContain("+line 25");
  });

  it("never exceeds the budget, and leaves full units untouched", () => {
    const units = dedupeUnits(
      parseDiff(markdown("a.md", hunk(1, 2000, "alpha")) + markdown("b.md", hunk(1, 2000, "beta")) + modified("c.ts", "-x\n+y\n"))
    );
    for (const budget of [0, 50, 500, 8_000, 50_000]) {
      expect(total(renderWithinBudget(units, budget))).toBeLessThanOrEqual(budget);
    }
    const small = dedupeUnits(parseDiff(modified("c.ts", "-x\n+y\n")));
    expect(renderWithinBudget(small, 10_000)).toEqual([renderUnit(small[0] ?? { files: [] }, Detail.Full)]);
  });

  it("shows a fully funded file whole, with no false cut", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `+const x${i} = 1;\n`).join("");
    const units = dedupeUnits(parseDiff(markdown("src/big.ts", `@@ -1,1 +1,4000 @@\n${big}`) + markdown("src/small.md", hunk(1, 1, "only"))));
    const texts = renderWithinBudget(units, 3_000);
    expect(texts[1]).toContain("+only line 0");
    expect(texts[1]).not.toContain("more changed lines cut");
  });

  it("spends the budget on a file with many small hunks", () => {
    const hunks = Array.from({ length: 1000 }, (_, i) => hunk(i * 10 + 1, 1, `h${i}`)).join("");
    const [text = ""] = renderWithinBudget(dedupeUnits(parseDiff(markdown("docs/a.md", hunks))), 8_000);
    expect(text).toContain("+h0 line 0");
    expect(text).toMatch(/# \.\.\. \d+ more changed lines cut/);
    expect(text.length).toBeGreaterThan(7_000);
  });

  it("spends the budget when there are too many files for each to get a share", () => {
    const files = Array.from({ length: 3000 }, (_, i) => markdown(`docs/f${i}.md`, hunk(1, 30, `f${i}`))).join("");
    const texts = renderWithinBudget(dedupeUnits(parseDiff(files)), 48_000);
    expect(total(texts)).toBeGreaterThan(40_000);
    expect(total(texts)).toBeLessThanOrEqual(48_000);
    expect(texts.some((text) => text.includes(" line 0"))).toBe(true);
  });

  it("hands a share no line can use to the other files", () => {
    const units = dedupeUnits(parseDiff(modified("data.json", "+" + "x".repeat(200_000) + "\n") + markdown("src/n.md", hunk(1, 2000, "alpha"))));
    const texts = renderWithinBudget(units, 40_000);
    expect((texts[1] ?? "").length).toBeGreaterThan(35_000);
    expect(total(texts)).toBeLessThanOrEqual(40_000);
  });

  describe("deleted files", () => {
    const body = Array.from({ length: 200 }, (_, i) => `-gone line ${i} of the deleted file\n`).join("");
    const deleted = (path: string): string =>
      `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n@@ -1,200 +0,0 @@\n${body}`;

    it("never crowd out other files", () => {
      const texts = renderWithinBudget(dedupeUnits(parseDiff(added("src/n.ts", 1500) + deleted("d.ts"))), 8_000);
      expect(texts[0]).toContain("+line 0");
      expect(texts[1]).toBe("");
    });

    it("take what the other files leave over", () => {
      const texts = renderWithinBudget(dedupeUnits(parseDiff(modified("src/a.md", "+".repeat(20_000) + "\n") + deleted("d.ts"))), 4_000);
      expect(texts[1]).toContain("-gone line 0");
      expect(total(texts)).toBeLessThanOrEqual(4_000);
    });

    it("show real content when a commit only removes files", () => {
      const [text = ""] = renderWithinBudget(dedupeUnits(parseDiff(deleted("d.ts"))), 2_000);
      expect(text).toContain("-gone line 0");
      expect(text).toMatch(/# \.\.\. \d+ more changed lines cut/);
    });
  });

  it("keeps a single huge line at its current rendering", () => {
    const units = dedupeUnits(parseDiff(modified("data.json", "+" + "x".repeat(50_000) + "\n")));
    expect(renderWithinBudget(units, 8_000)[0] ?? "").not.toContain("xxxx");
  });
});
