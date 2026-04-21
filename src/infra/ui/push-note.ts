export { renderPushNote, type PushMetadata };

import * as p from "@clack/prompts";

import type { CommitMetadata, PushRange } from "@/infra/git/repo";
import type { PrLookup } from "@/infra/github/pr";
import { Just, type Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";

type PushMetadata = {
  commit: CommitMetadata;
  localBranch: string;
  upstream: Maybe<string>;
  remoteUrl: string;
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
    case "unavailable":
      return [];
    default:
      return absurd(lookup, "PrLookup");
  }
};

const renderPushNote = (m: PushMetadata): void => {
  const branchLine =
    m.upstream instanceof Just ? `branch   ${m.localBranch} → ${m.upstream.value}` : `branch   ${m.localBranch}`;

  const rangeLine = m.range instanceof Just ? [`range    ${m.range.value.before}..${m.range.value.after}`] : [];

  const body = [
    `commit   ${m.commit.short}  ${m.commit.subject}`,
    `author   ${m.commit.authorName} <${m.commit.authorEmail}>`,
    `date     ${formatDate(m.commit.date)}`,
    branchLine,
    `remote   ${m.remoteUrl}`,
    ...rangeLine,
    ...renderPrLine(m.pr)
  ].join("\n");

  p.note(body, "Pushed");
};
