/*
Grouping hints for the split prompt: pairs of staged files that probably belong together. Pure.

Three edge sources; a pair found by several keeps every reason:
    test      a test file and the one source file with the same stem (`plan.test.ts` -> `plan.ts`);
              skipped when the stem matches several sources (`index.ts`)
    imports   `git grep --cached` lines (`path:content`) whose specifier resolves to another
              staged path: relative specifiers against the importer's dir, others by path suffix
              after a leading `@/` or `~/` (`@/infra/git/repo` -> `src/infra/git/repo.ts`);
              package names (`react`, `@scope/pkg`, `node:path`) are skipped
    history   two staged files changed together in 2+ of the recent commits (`git log
              --name-only --format=%x1e` records); commits touching more than 20 files are skipped

Pairs stay pairs: imports and history connect most of a codebase, so merging them transitively
would make one cluster of everything. The MAX_HINTS strongest are kept, ranked by best reason
(test, imports, history), then by how many reasons agree. Hints are suggestions for the model;
nothing here decides a group.
*/
export { HintReason, groupingHints, type HintCluster };

import { isTestPath } from "@/domain/context/diff";
import { fromOptional, Just, mapMaybe, Nothing, type Maybe } from "@/libs/maybe";
import { posix } from "node:path";

const HintReason = { Test: "test", Imports: "imports", History: "history" } as const;
type HintReason = (typeof HintReason)[keyof typeof HintReason];

type HintCluster = { readonly files: readonly string[]; readonly reasons: readonly HintReason[] };
type Edge = { readonly a: string; readonly b: string; readonly reason: HintReason };

const MAX_COMMIT_FILES = 20;
const MIN_CO_CHANGES = 2;
const MAX_HINTS = 25;
const REASON_ORDER: readonly HintReason[] = [HintReason.Test, HintReason.Imports, HintReason.History];
const IMPORT_SPECIFIER_RE = /(?:from|import|require\()\s*["']([^"']+)["']/;

const compare = (x: string, y: string): number =>
  x < y ? -1
  : x > y ? 1
  : 0;

const withoutExtension = (path: string): string => path.replace(/\.[^./]+$/, "");

const stemOf = (path: string): string => withoutExtension(posix.basename(path)).replace(/\.(test|spec)$/, "");

const testEdges = (paths: readonly string[]): readonly Edge[] => {
  const sources = paths.filter((path) => !isTestPath(path));
  return paths.filter(isTestPath).flatMap((test) => {
    const matches = sources.filter((source) => stemOf(source) === stemOf(test));
    const [only] = matches;
    return matches.length === 1 && only !== undefined ? [{ a: test, b: only, reason: HintReason.Test }] : [];
  });
};

type ImportLine = { readonly importer: string; readonly specifier: string };

const parseImportLine = (line: string): Maybe<ImportLine> => {
  const colon = line.indexOf(":");
  return fromOptional(colon === -1 ? undefined : IMPORT_SPECIFIER_RE.exec(line.slice(colon + 1))?.[1]).map((specifier) => ({
    importer: line.slice(0, colon),
    specifier
  }));
};

// Package names (`react`, `node:path`, `@scope/pkg`) resolve to nothing, so a staged `react.ts` is not linked.
const resolveSpecifier = ({ importer, specifier }: ImportLine): Maybe<string> => {
  const bare = specifier.replace(/\.(m|c)?[jt]sx?$/, "");
  return (
    bare.startsWith("./") || bare.startsWith("../") ? Just(posix.normalize(posix.join(posix.dirname(importer), bare)))
    : /^(@|~)\//.test(bare) ? Just(bare.slice(2))
    : bare.includes("/") && !bare.startsWith("@") && !bare.includes(":") ? Just(bare)
    : Nothing()
  );
};

const matchesResolved = (path: string, resolved: string): boolean => {
  const bare = withoutExtension(path);
  return bare === resolved || bare.endsWith(`/${resolved}`) || bare === `${resolved}/index`;
};

const importEdges = (paths: readonly string[], grepOutput: string): readonly Edge[] =>
  mapMaybe(grepOutput.split("\n"), parseImportLine)
    .filter(({ importer }) => paths.includes(importer))
    .flatMap((line) =>
      resolveSpecifier(line).maybe<readonly Edge[]>([], (resolved) =>
        paths
          .filter((path) => path !== line.importer && matchesResolved(path, resolved))
          .map((path) => ({ a: line.importer, b: path, reason: HintReason.Imports }))
      )
    );

const historyEdges = (paths: readonly string[], logOutput: string): readonly Edge[] => {
  const staged = new Set(paths);
  const counts = new Map<string, { a: string; b: string; n: number }>();
  for (const record of logOutput.split("\x1e")) {
    const changed = [...new Set(record.split("\n").filter((line) => line.trim() !== ""))];
    if (changed.length > MAX_COMMIT_FILES) continue;
    const files = changed.filter((file) => staged.has(file)).sort(compare);
    for (const [i, a] of files.entries()) {
      for (const b of files.slice(i + 1)) {
        const key = `${a}\0${b}`;
        counts.set(key, { a, b, n: (counts.get(key)?.n ?? 0) + 1 });
      }
    }
  }
  return [...counts.values()].filter(({ n }) => n >= MIN_CO_CHANGES).map(({ a, b }) => ({ a, b, reason: HintReason.History }));
};

const reasonRank = (hint: HintCluster): number => REASON_ORDER.findIndex((reason) => hint.reasons.includes(reason));

// Strongest first: best reason, then more reasons, then path order.
const compareHints = (x: HintCluster, y: HintCluster): number =>
  reasonRank(x) - reasonRank(y) || y.reasons.length - x.reasons.length || compare(x.files.join("\0"), y.files.join("\0"));

const pairs = (edges: readonly Edge[]): readonly HintCluster[] => {
  const byPair = new Map<string, { files: readonly [string, string]; reasons: Set<HintReason> }>();
  for (const { a, b, reason } of edges.filter((edge) => edge.a !== edge.b)) {
    const files: readonly [string, string] = compare(a, b) < 0 ? [a, b] : [b, a];
    const key = files.join("\0");
    byPair.set(key, { files, reasons: (byPair.get(key)?.reasons ?? new Set<HintReason>()).add(reason) });
  }
  return [...byPair.values()]
    .map(({ files, reasons }) => ({ files, reasons: REASON_ORDER.filter((reason) => reasons.has(reason)) }))
    .sort(compareHints)
    .slice(0, MAX_HINTS);
};

const groupingHints = (paths: readonly string[], grepOutput: string, logOutput: string): readonly HintCluster[] =>
  pairs([...testEdges(paths), ...importEdges(paths, grepOutput), ...historyEdges(paths, logOutput)]);
