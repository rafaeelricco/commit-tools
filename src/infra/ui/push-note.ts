export { renderPushNote, type PushMetadata };

import * as p from "@clack/prompts";

import type { CommitMetadata, PushRange } from "@/infra/git/repo";
import type { PrLookup } from "@/infra/github/pr";
import type { Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";

type PushMetadata = {
  commit: Maybe<CommitMetadata>;
  localBranch: Maybe<string>;
  baseBranch: Maybe<string>;
  remoteUrl: Maybe<string>;
  range: Maybe<PushRange>;
  pr: PrLookup;
};

const formatDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

const renderPrLine = (lookup: PrLookup): string[] => {
  switch (lookup.type) {
    case "found":
      return [`pr       #${lookup.pr.number} ${lookup.pr.url}`];
    case "unauthenticated":
      return [`pr       Tip: run 'gh auth login' to show open PR in the current branch...`];
    case "not-found":
    case "unavailable":
      return [];
    default:
      return absurd(lookup, "PrLookup");
  }
};

const renderCommitLines = (commit: Maybe<CommitMetadata>): string[] =>
  commit.maybe<string[]>([], (value) => [
    `commit   ${value.short}  ${value.subject}`,
    `author   ${value.authorName} <${value.authorEmail}>`,
    `date     ${formatDate(value.date)}`
  ]);

const renderPushNote = (m: PushMetadata): void => {
  const branchLine = m.localBranch.maybe<string[]>([], (branch) => [`branch   ${branch}`]);
  const baseLine = m.baseBranch.maybe<string[]>([], (base) => [`base     ${base}`]);
  const remoteLine = m.remoteUrl.maybe<string[]>([], (url) => [`remote   ${url}`]);
  const rangeLine = m.range.maybe<string[]>([], (range) => [`range    ${range.before}..${range.after}`]);

  const body = [...renderCommitLines(m.commit), ...branchLine, ...baseLine, ...remoteLine, ...rangeLine, ...renderPrLine(m.pr)].join("\n");

  if (!body) return;

  p.note(body, "Pushed");
};
