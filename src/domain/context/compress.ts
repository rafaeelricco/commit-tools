/*
Render parsed file diffs at four levels of detail and fit them under a character budget. Pure.

    full      git's own text for the file
    changes   hunk headers + only the +/- lines (context lines dropped); a new file shows its
              first NEW_FILE_PREVIEW lines, then only declarations
    outline   the stat line, and the headers of hunks that change a declaration line (function/
              class/type/const/def/fn..., and describe/it/test names in test files) with those lines
    stat      the manifest line only

`dedupeUnits` first folds files whose +/- lines are identical (the same edit across N files) into
one unit rendered once. `fitToBudget` then lowers detail one unit at a time — test files first,
then the largest — through changes, outline and stat until the total fits. Deleted and binary
files never render below `full` as more than their stat line.
`renderWithinBudget` then spends what is left: units with more changed lines to show get them
back, source first, then tests, then deleted files, cut at a `# ... N more changed lines cut`
marker, with fair shares across units and every hunk of a file represented before any hunk gets
more. Binary files stay in the manifest.
*/
export { Detail, statLine, renderUnit, dedupeUnits, fitToBudget, fairShares, renderWithinBudget, type RenderUnit };

import { type FileDiff, type Hunk, isTestPath } from "@/domain/context/diff";
import { absurd } from "@/libs/types";

const Detail = { Full: "full", Changes: "changes", Outline: "outline", Stat: "stat" } as const;
type Detail = (typeof Detail)[keyof typeof Detail];

const DEGRADE_ORDER: readonly Detail[] = [Detail.Changes, Detail.Outline, Detail.Stat];
const NEW_FILE_PREVIEW = 20;
const MIN_USEFUL_SHARE = 200;
const MAX_SPEND_ROUNDS = 4;
const DECLARATION_RE =
  /^[+-]\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|def|fn|func|struct|impl|trait|module)\b|^[+-]\s*(describe|it|test)(\.\w+)?\(/;

type RenderUnit = { readonly files: readonly FileDiff[] };

const statLine = (file: FileDiff): string => {
  switch (file.change.tag) {
    case "added":
      return `A ${file.path} (new, ${file.added} lines)`;
    case "deleted":
      return `D ${file.path} (deleted, ${file.deleted} lines)`;
    case "renamed":
      return `R${file.change.similarity} ${file.change.from} -> ${file.path} +${file.added} -${file.deleted}`;
    case "binary":
      return `B ${file.path} (binary)`;
    case "modified":
      return `M ${file.path} +${file.added} -${file.deleted}`;
    default:
      return absurd(file.change, "FileChange");
  }
};

const isChanged = (line: string): boolean => line.startsWith("+") || line.startsWith("-");

const changedLines = (file: FileDiff): readonly string[] => file.hunks.flatMap((h) => h.lines.filter(isChanged));

const countChanged = (hunk: Hunk): number => hunk.lines.filter(isChanged).length;

// Hunk headers plus the changed lines `keep` accepts; `position` counts changed lines across the whole file.
// A hunk left with no lines is dropped, header included: a bare `@@` line says nothing.
const renderHunks = (file: FileDiff, keep: (line: string, position: number) => boolean): readonly string[] => {
  const starts = file.hunks.reduce<readonly number[]>((acc, hunk, i) => [...acc, (acc[i] ?? 0) + countChanged(hunk)], [0]);
  return file.hunks.flatMap((hunk, i) => {
    const kept = hunk.lines.filter(isChanged).filter((line, j) => keep(line, (starts[i] ?? 0) + j));
    return kept.length === 0 ? [] : [hunk.header, ...kept];
  });
};

const keepChanges = (file: FileDiff): ((line: string, position: number) => boolean) =>
  file.change.tag === "added" ? (line, position) => position < NEW_FILE_PREVIEW || DECLARATION_RE.test(line) : () => true;

const isStatOnly = (file: FileDiff): boolean => file.change.tag === "deleted" || file.change.tag === "binary";

const renderFile = (file: FileDiff, detail: Detail): string => {
  if (detail === Detail.Full) return file.raw;
  if (isStatOnly(file)) return statLine(file);
  switch (detail) {
    case Detail.Changes:
      return [statLine(file), ...renderHunks(file, keepChanges(file))].join("\n");
    case Detail.Outline:
      return [statLine(file), ...renderHunks(file, (line) => DECLARATION_RE.test(line))].join("\n");
    case Detail.Stat:
      return statLine(file);
    default:
      return absurd(detail, "Detail");
  }
};

const sameChangeHeader = (unit: RenderUnit): string =>
  unit.files.length < 2 ? "" : `# Same change in ${unit.files.length} files: ${unit.files.map((f) => f.path).join(", ")}\n`;

const renderUnit = (unit: RenderUnit, detail: Detail): string => {
  const [first] = unit.files;
  return first === undefined ? "" : sameChangeHeader(unit) + renderFile(first, detail);
};

const dedupeUnits = (files: readonly FileDiff[]): readonly RenderUnit[] => {
  const bySignature = new Map<string, FileDiff[]>();
  const units: RenderUnit[] = [];
  for (const file of files) {
    const signature = changedLines(file).join("\n");
    const group = signature === "" ? undefined : bySignature.get(signature);
    if (group === undefined) {
      const fresh = [file];
      if (signature !== "") bySignature.set(signature, fresh);
      units.push({ files: fresh });
    } else {
      group.push(file);
    }
  }
  return units;
};

const degradePriority = (units: readonly RenderUnit[]): readonly number[] =>
  units
    .map((unit, index) => ({ index, test: unit.files.every((f) => isTestPath(f.path)), size: renderUnit(unit, Detail.Full).length }))
    .sort((a, b) => Number(b.test) - Number(a.test) || b.size - a.size)
    .map((u) => u.index);

/** Detail per unit, same order as `units`. */
const fitToBudget = (units: readonly RenderUnit[], budgetChars: number): readonly Detail[] => {
  const order = degradePriority(units);
  const steps = DEGRADE_ORDER.flatMap((detail) => order.map((index) => ({ index, detail })));
  const start = { details: units.map((): Detail => Detail.Full), total: units.reduce((n, u) => n + renderUnit(u, Detail.Full).length + 1, 0) };
  return steps.reduce(({ details, total }, { index, detail }) => {
    const unit = units[index];
    const current = details[index];
    if (total <= budgetChars || unit === undefined || current === undefined) return { details, total };
    const next = details.map((d, i) => (i === index ? detail : d));
    return { details: next, total: total - renderUnit(unit, current).length + renderUnit(unit, detail).length };
  }, start).details;
};

/** Split `total` across `sizes` so small items get all they need and the rest share what remains. */
const fairShares = (sizes: readonly number[], total: number): readonly number[] => {
  const ascending = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size);
  const shares = sizes.map(() => 0);
  ascending.reduce((remaining, { size, index }, position) => {
    const share = Math.min(size, Math.floor(remaining / (ascending.length - position)));
    shares[index] = share;
    return remaining - share;
  }, total);
  return shares;
};

// Changed lines per hunk, taken one per hunk per round so every hunk is represented before any hunk
// gets a second line. A line too long for what is left is skipped.
const roundRobinLines = (file: FileDiff, limit: number): readonly (readonly string[])[] => {
  const changed = file.hunks.map((hunk) => hunk.lines.filter(isChanged));
  const kept = changed.map((): string[] => []);
  const next = changed.map(() => 0);
  let left = limit;
  let open = changed.map((_, i) => i);
  while (open.length > 0) {
    open = open.filter((i) => {
      const position = next[i] ?? 0;
      const line = changed[i]?.[position];
      const lines = kept[i];
      if (line === undefined || lines === undefined) return false;
      next[i] = position + 1;
      const cost = line.length + 1 + (lines.length === 0 ? (file.hunks[i]?.header.length ?? 0) + 1 : 0);
      if (cost <= left) {
        lines.push(line);
        left -= cost;
      }
      return true;
    });
  }
  return kept;
};

const allChangesLength = (file: FileDiff): number =>
  file.hunks.reduce(
    (n, hunk) => n + hunk.lines.filter(isChanged).reduce((m, line) => m + line.length + 1, hunk.header.length + 1),
    statLine(file).length
  );

/** Stat line plus changed lines from every hunk, cut to `limit` chars at whole lines, ending in a cut marker. */
const truncatedChanges = (file: FileDiff, limit: number): string => {
  const stat = statLine(file);
  const totalLines = file.hunks.reduce((n, hunk) => n + countChanged(hunk), 0);
  const marker = (lines: number): string => `# ... ${lines} more changed lines cut`;
  const reserve = limit >= allChangesLength(file) ? 0 : marker(totalLines).length + 1;
  const kept = roundRobinLines(file, Math.max(0, limit - stat.length - reserve));
  const keptLines = kept.reduce((n, lines) => n + lines.length, 0);
  if (keptLines === 0) return stat;
  const body = file.hunks.flatMap((hunk, i) => {
    const lines = kept[i] ?? [];
    return lines.length === 0 ? [] : [hunk.header, ...lines];
  });
  return [stat, ...body, ...(keptLines < totalLines ? [marker(totalLines - keptLines)] : [])].join("\n");
};

const renderedChars = (texts: readonly string[]): number => texts.reduce((n, text) => (text === "" ? n : n + text.length + 1), 0);

// What leftover budget serves first: source, then tests, then the bodies of deleted files.
const spendTier = (unit: RenderUnit): number => {
  if (unit.files.every((f) => f.change.tag === "deleted")) return 2;
  return unit.files.every((f) => isTestPath(f.path)) ? 1 : 0;
};

// One round of spending: by tier, then the cheapest units first, each funded with at least
// MIN_USEFUL_SHARE when the budget allows. A unit that could not use its share (its lines are too
// long) drops out, and later rounds hand what it left to the others.
const spendLeftover = (
  units: readonly RenderUnit[],
  texts: readonly string[],
  open: readonly number[],
  budgetChars: number,
  rounds: number
): readonly string[] => {
  const left = budgetChars - renderedChars(texts);
  if (rounds === 0 || left <= 0) return texts;
  const ranked = open
    .flatMap((index) => {
      const unit = units[index];
      const first = unit?.files[0];
      if (unit === undefined || first === undefined) return [];
      const text = texts[index] ?? "";
      const gain = sameChangeHeader(unit).length + allChangesLength(first) - text.length + (text === "" ? 1 : 0);
      return gain > 0 ? [{ index, unit, first, text, gain, tier: spendTier(unit) }] : [];
    })
    .sort((a, b) => a.tier - b.tier || a.gain - b.gain);
  if (ranked.length === 0) return texts;
  const picked = ranked.slice(0, Math.max(1, Math.floor(left / MIN_USEFUL_SHARE)));
  const shares = [0, 1, 2].reduce<{ readonly byIndex: ReadonlyMap<number, number>; readonly remaining: number }>(
    ({ byIndex, remaining }, tier) => {
      const members = picked.filter((c) => c.tier === tier);
      const tierShares = fairShares(
        members.map((c) => c.gain),
        remaining
      );
      return {
        byIndex: new Map([...byIndex, ...members.map((c, i) => [c.index, tierShares[i] ?? 0] as const)]),
        remaining: remaining - tierShares.reduce((n, share) => n + share, 0)
      };
    },
    { byIndex: new Map(), remaining: left }
  ).byIndex;
  const grown = new Map(
    picked.flatMap(({ index, unit, first, text }) => {
      const header = sameChangeHeader(unit);
      const body = truncatedChanges(first, text.length + (shares.get(index) ?? 0) - (text === "" ? 1 : 0) - header.length);
      return body === statLine(first) || header.length + body.length <= text.length ? [] : [[index, header + body] as const];
    })
  );
  return spendLeftover(
    units,
    texts.map((text, index) => grown.get(index) ?? text),
    open.filter((index) => grown.has(index) || (shares.get(index) ?? 0) === 0),
    budgetChars,
    rounds - 1
  );
};

/**
 * Text per unit, same order as `units`; "" for a unit left to the manifest. Total stays within budgetChars.
 * Deleted and binary files start empty, so a deleted body only takes what every other file left over.
 */
const renderWithinBudget = (units: readonly RenderUnit[], budgetChars: number): readonly string[] => {
  const details = fitToBudget(units, budgetChars);
  const base = units.map((unit, i) => {
    const detail = details[i] ?? Detail.Stat;
    return detail === Detail.Stat || unit.files.every(isStatOnly) ? "" : renderUnit(unit, detail);
  });
  const open = units.flatMap((unit, index) => ((unit.files[0]?.hunks.length ?? 0) === 0 ? [] : [index]));
  return spendLeftover(units, base, open, budgetChars, MAX_SPEND_ROUNDS);
};
