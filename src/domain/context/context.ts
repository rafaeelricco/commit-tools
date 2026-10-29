/*
Build the text every model call sees for the staged changes, once per `commit` run.

    buildStagedContext(snapshot, files)
        |-- manifest   one statLine per parsed file + the generated-files note
        |-- hints      groupingHints() over non-generated paths
        |-- diff       whole: snapshot.diff + generatedNote, exactly what getStagedDiff returns,
        |                     when it fits CONTEXT_BUDGET_TOKENS
        v              compressed: legend, "# Files" manifest, "# Changes" from fitToBudget()
                               (units at stat level are left to the manifest)

Tokens are estimated as chars / 4, the same estimate `pnpm measure` prints.
*/
export { CONTEXT_BUDGET_TOKENS, estimateTokens, buildStagedContext, type StagedSnapshot, type StagedContext, type ContextSize };

import { parseDiff } from "@/domain/context/diff";
import { Detail, dedupeUnits, fitToBudget, renderUnit, statLine } from "@/domain/context/compress";
import { groupingHints, type HintCluster } from "@/domain/context/hints";
import { isGeneratedPath } from "@/infra/git/parsers";

const CONTEXT_BUDGET_TOKENS = 12_000;
const CHARS_PER_TOKEN = 4;

type StagedSnapshot = {
  readonly diff: string;
  readonly generatedNote: string;
  readonly importLines: string;
  readonly history: string;
};

type ContextSize =
  | { readonly tag: "whole"; readonly tokens: number }
  | { readonly tag: "compressed"; readonly tokens: number; readonly fullTokens: number };

type StagedContext = {
  readonly files: readonly string[];
  readonly manifest: string;
  readonly hints: readonly HintCluster[];
  readonly diff: string;
  readonly size: ContextSize;
};

const LEGEND =
  "# Large change, compressed to fit. '# Files' lists every staged file (A added, M modified, D deleted, " +
  "R<similarity> renamed, B binary) with line counts. '# Changes' shows the files that matter most: " +
  "context lines removed, some files cut to hunk headers and declarations. Files absent there are summarized in '# Files' only.";

const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

const buildStagedContext = (snapshot: StagedSnapshot, files: readonly string[], budgetTokens: number = CONTEXT_BUDGET_TOKENS): StagedContext => {
  const parsed = parseDiff(snapshot.diff);
  const manifest = parsed.map(statLine).join("\n") + snapshot.generatedNote;
  const hints = groupingHints(
    files.filter((f) => !isGeneratedPath(f)),
    snapshot.importLines,
    snapshot.history
  );
  const whole = snapshot.diff + snapshot.generatedNote;
  const fullTokens = estimateTokens(whole.length);
  if (fullTokens <= budgetTokens) {
    return { files, manifest, hints, diff: whole, size: { tag: "whole", tokens: fullTokens } };
  }
  const head = `${LEGEND}\n\n# Files\n${manifest}\n\n# Changes\n`;
  const units = dedupeUnits(parsed);
  const details = fitToBudget(units, Math.max(0, budgetTokens * CHARS_PER_TOKEN - head.length));
  const changes = units
    .map((unit, i) => (details[i] === Detail.Stat ? "" : renderUnit(unit, details[i] ?? Detail.Stat)))
    .filter((text) => text !== "")
    .join("\n");
  const diff = head + changes;
  return { files, manifest, hints, diff, size: { tag: "compressed", tokens: estimateTokens(diff.length), fullTokens } };
};
