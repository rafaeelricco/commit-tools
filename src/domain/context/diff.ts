/*
Parse `git diff --staged` text into one record per file. Pure; no git calls.

Reads the headers git already prints: `new file mode`, `deleted file mode`, `rename from/to` +
`similarity index`, `Binary files ... differ`. Paths come from `+++ b/`, `--- a/` or `rename to`
before the `diff --git` line, so paths with spaces parse. Text that is not a `diff --git` chunk
(e.g. the generated-files note) is ignored; callers keep that note apart.
*/
export { parseDiff, isTestPath, type FileDiff, type FileChange, type Hunk };

import { fromOptional, type Maybe } from "@/libs/maybe";

type FileChange =
  | { readonly tag: "added" }
  | { readonly tag: "deleted" }
  | { readonly tag: "modified" }
  | { readonly tag: "renamed"; readonly from: string; readonly similarity: number }
  | { readonly tag: "binary" };

type Hunk = { readonly header: string; readonly lines: readonly string[] };

type FileDiff = {
  readonly path: string;
  readonly change: FileChange;
  readonly hunks: readonly Hunk[];
  readonly added: number;
  readonly deleted: number;
  readonly raw: string;
};

const TEST_PATH_RE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[^./]+$/;

const isTestPath = (path: string): boolean => TEST_PATH_RE.test(path);

const parseDiff = (diff: string): readonly FileDiff[] =>
  diff
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map(parseChunk);

const headerValue = (header: readonly string[], prefix: string): Maybe<string> =>
  fromOptional(header.find((line) => line.startsWith(prefix))).map((line) => line.slice(prefix.length).replace(/\t$/, ""));

// `diff --git a/P b/P` when the other headers carry no path (binary files, mode-only changes).
const pathFromGitLine = (line: string): string => {
  const rest = line.slice("diff --git ".length);
  const half = (rest.length - " a/ b/".length + 1) / 2;
  const mirrored = Number.isInteger(half) && rest.slice(2, 2 + half) === rest.slice(rest.length - half);
  return mirrored ? rest.slice(2, 2 + half) : rest.slice(rest.lastIndexOf(" b/") + " b/".length);
};

const parseHunk = (text: string): Hunk => {
  const [header = "", ...lines] = text.replace(/\n$/, "").split("\n");
  return { header, lines };
};

const countLines = (hunks: readonly Hunk[], prefix: string): number => hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith(prefix)).length, 0);

const parseChange = (header: readonly string[]): FileChange =>
  header.some((line) => line.startsWith("Binary files ")) ? { tag: "binary" }
  : header.some((line) => line.startsWith("new file mode ")) ? { tag: "added" }
  : header.some((line) => line.startsWith("deleted file mode ")) ? { tag: "deleted" }
  : headerValue(header, "rename from ").maybe<FileChange>({ tag: "modified" }, (from) => ({
      tag: "renamed",
      from,
      similarity: headerValue(header, "similarity index ").maybe(0, (s) => Number.parseInt(s, 10) || 0)
    }));

const parseChunk = (raw: string): FileDiff => {
  const [head = "", ...hunkTexts] = raw.split(/^(?=@@ )/m);
  const header = head.split("\n");
  const hunks = hunkTexts.map(parseHunk);
  const path = headerValue(header, "rename to ")
    .alt(headerValue(header, "+++ b/"))
    .alt(headerValue(header, "--- a/"))
    .withDefault(pathFromGitLine(header[0] ?? ""));
  return { path, change: parseChange(header), hunks, added: countLines(hunks, "+"), deleted: countLines(hunks, "-"), raw };
};
