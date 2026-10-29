import { describe, expect, it } from "vitest";
import { groupingHints } from "@/domain/context/hints";

const PATHS = ["src/domain/split/plan.ts", "test/domain/split/plan.test.ts", "src/cli/split.ts", "src/infra/git/repo.ts", "README.md"];

describe("groupingHints", () => {
  it("pairs a test with its single same-stem source", () => {
    expect(groupingHints(PATHS, "", "")).toEqual([{ files: ["src/domain/split/plan.ts", "test/domain/split/plan.test.ts"], reasons: ["test"] }]);
  });

  it("skips ambiguous stems", () => {
    expect(groupingHints(["src/a/index.ts", "src/b/index.ts", "test/index.test.ts"], "", "")).toEqual([]);
  });

  it("links alias and relative imports between staged files", () => {
    const grep =
      'src/cli/split.ts:import * as repo from "@/infra/git/repo";\nsrc/domain/split/plan.ts:import { x } from "../../cli/split";\nsrc/cli/split.ts:import color from "picocolors";\n';
    expect(groupingHints(PATHS, grep, "")).toEqual([
      { files: ["src/domain/split/plan.ts", "test/domain/split/plan.test.ts"], reasons: ["test"] },
      { files: ["src/cli/split.ts", "src/domain/split/plan.ts"], reasons: ["imports"] },
      { files: ["src/cli/split.ts", "src/infra/git/repo.ts"], reasons: ["imports"] }
    ]);
  });

  it("does not link package imports to same-named staged files", () => {
    const grep = 'src/a.ts:import React from "react";\nsrc/a.ts:import { z } from "@scope/zod";\nsrc/a.ts:import { join } from "node:path";\n';
    expect(groupingHints(["src/a.ts", "src/utils/react.ts", "src/zod.ts", "src/path.ts"], grep, "")).toEqual([]);
  });

  it("keeps pairs apart instead of chaining them into one cluster", () => {
    const grep = 'a.ts:import "./b";\nb.ts:import "./c";\nc.ts:import "./d";\n';
    expect(groupingHints(["a.ts", "b.ts", "c.ts", "d.ts"], grep, "").map((h) => h.files)).toEqual([
      ["a.ts", "b.ts"],
      ["b.ts", "c.ts"],
      ["c.ts", "d.ts"]
    ]);
  });

  it("merges reasons for the same pair and ranks agreeing pairs first", () => {
    const grep = 'src/x.ts:import { y } from "./y";\n';
    const log = "\x1e\n\nsrc/x.ts\nsrc/y.ts\nsrc/z.ts\n\x1e\n\nsrc/x.ts\nsrc/y.ts\nsrc/z.ts\n";
    expect(groupingHints(["src/x.ts", "src/y.ts", "src/z.ts"], grep, log)).toEqual([
      { files: ["src/x.ts", "src/y.ts"], reasons: ["imports", "history"] },
      { files: ["src/x.ts", "src/z.ts"], reasons: ["history"] },
      { files: ["src/y.ts", "src/z.ts"], reasons: ["history"] }
    ]);
  });

  it("caps the number of hints", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.ts`);
    const log = `\x1e\n\n${paths.join("\n")}\n`.repeat(2);
    expect(groupingHints(paths, "", log)).toHaveLength(25);
  });

  it("links files changed together in 2+ commits, ignoring huge commits", () => {
    const big = Array.from({ length: 25 }, (_, i) => `f${i}.ts`).join("\n");
    const log = `\x1e\n\nsrc/cli/split.ts\nREADME.md\n\x1e\n\nsrc/cli/split.ts\nREADME.md\n\x1e\n\nsrc/infra/git/repo.ts\n${big}\n`;
    expect(groupingHints(["src/cli/split.ts", "README.md", "src/infra/git/repo.ts"], "", log)).toEqual([
      { files: ["README.md", "src/cli/split.ts"], reasons: ["history"] }
    ]);
  });
});
