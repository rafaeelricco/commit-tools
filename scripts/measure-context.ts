/*
Dev-only: estimate where prompt tokens go for the currently staged changes. Makes no model call.

    pnpm measure [conventional|imperative|custom]

Builds the same StagedContext and prompts `commit` would send, then prints:
    1. prompt sections   system instruction, file list, prompt scaffolding, diff
    2. context           whole vs compressed size against CONTEXT_BUDGET_TOKENS, hints
    3. heaviest files    per-file share of the full staged diff

Tokens are estimated as chars / 4. Compare with the real "tokens input" in the note `commit`
prints after a run to calibrate. Generated files are excluded the same way `getStagedSnapshot` does.
*/
import * as repo from "@/infra/git/repo";
import { isGeneratedPath } from "@/infra/git/parsers";
import { buildStagedContext, estimateTokens, CONTEXT_BUDGET_TOKENS, type StagedSnapshot } from "@/domain/context/context";
import { getPrompt, getSplitPrompt } from "@/domain/commit/prompts";
import { type CommitConvention } from "@/domain/config/config";
import { Future } from "@/libs/future";
import { Nothing } from "@/libs/maybe";

type Row = { readonly label: string; readonly chars: number };

const CONVENTIONS: readonly CommitConvention[] = ["conventional", "imperative", "custom"];
const TOP_FILES = 15;

const formatRows = (title: string, rows: readonly Row[], baseline: number): string => {
  const width = Math.max(...rows.map((r) => r.label.length));
  const lines = rows.map((r) => {
    const tokens = estimateTokens(r.chars).toLocaleString("en-US").padStart(9);
    const share = baseline > 0 ? `${((r.chars / baseline) * 100).toFixed(1).padStart(5)}%` : "";
    return `  ${r.label.padEnd(width)}  ${tokens} tok  ${share}`;
  });
  return `${title}\n${lines.join("\n")}`;
};

const fileChunks = (diff: string): readonly Row[] =>
  diff
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map((chunk) => ({ label: /^diff --git a\/.* b\/(.*)$/m.exec(chunk)?.[1] ?? "?", chars: chunk.length }));

const parseConvention = (arg: string | undefined): CommitConvention => CONVENTIONS.find((c) => c === arg) ?? "imperative";

const report = (convention: CommitConvention, snapshot: StagedSnapshot, files: readonly string[]): string => {
  const context = buildStagedContext(snapshot, files);
  const full = snapshot.diff + snapshot.generatedNote;
  const diff = context.diff;
  const commit = getPrompt(diff, convention, Nothing());
  const split = getSplitPrompt(diff, files, convention, Nothing(), context.hints);
  const fileList = files.join("\n").length;
  const commitTotal = commit.systemInstruction.length + commit.prompt.length;

  const sections = [
    formatRows(
      `Commit prompt (${convention})`,
      [
        { label: "system instruction", chars: commit.systemInstruction.length },
        { label: "diff", chars: diff.length },
        { label: "total", chars: commitTotal }
      ],
      commitTotal
    ),
    formatRows(
      "Split prompt",
      [
        { label: "scaffolding", chars: split.length - diff.length - fileList },
        { label: "staged file list", chars: fileList },
        { label: "diff", chars: diff.length },
        { label: "total", chars: split.length }
      ],
      split.length
    ),
    formatRows(
      `Context (budget ${CONTEXT_BUDGET_TOKENS.toLocaleString("en-US")} tok, ${context.size.tag}, ${context.hints.length} hints)`,
      [
        { label: "full staged diff", chars: full.length },
        { label: "sent", chars: diff.length },
        { label: "manifest (adjust)", chars: context.manifest.length }
      ],
      full.length
    ),
    formatRows(
      `Heaviest files (top ${TOP_FILES} of ${files.length} staged, ${files.filter(isGeneratedPath).length} generated)`,
      [...fileChunks(full)].sort((a, b) => b.chars - a.chars).slice(0, TOP_FILES),
      full.length
    )
  ];
  return `${sections.join("\n\n")}\n\nEstimates: chars / 4. Each regenerate or adjust resends the diff.\n`;
};

repo
  .checkIsGitRepo()
  .chain(() => Future.concurrently({ snapshot: repo.getStagedSnapshot(), files: repo.listStagedPaths() }))
  .fork(
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
    ({ snapshot, files }) => console.log(report(parseConvention(process.argv[2]), snapshot, files))
  );
