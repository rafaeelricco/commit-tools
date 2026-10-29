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
*/
export { Detail, statLine, renderUnit, dedupeUnits, fitToBudget, type RenderUnit };

import { type FileDiff, type Hunk, isTestPath } from "@/domain/context/diff";
import { absurd } from "@/libs/types";

const Detail = { Full: "full", Changes: "changes", Outline: "outline", Stat: "stat" } as const;
type Detail = (typeof Detail)[keyof typeof Detail];

const DEGRADE_ORDER: readonly Detail[] = [Detail.Changes, Detail.Outline, Detail.Stat];
const NEW_FILE_PREVIEW = 20;
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

const renderFile = (file: FileDiff, detail: Detail): string => {
  if (detail === Detail.Full) return file.raw;
  if (file.change.tag === "deleted" || file.change.tag === "binary") return statLine(file);
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

const renderUnit = (unit: RenderUnit, detail: Detail): string => {
  const [first, ...rest] = unit.files;
  if (first === undefined) return "";
  return rest.length === 0 ?
      renderFile(first, detail)
    : `# Same change in ${unit.files.length} files: ${unit.files.map((f) => f.path).join(", ")}\n${renderFile(first, detail)}`;
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
