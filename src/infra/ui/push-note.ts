export { renderPushNote, type PushMetadata };

import * as p from "@clack/prompts";

import type { CommitMetadata, PushRange } from "@/infra/git/repo";
import type { PrLookup } from "@/infra/github/pr";
import { Just, type Maybe } from "@/libs/maybe";
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
  // TODO: Why we check if it's a Just here and not in the caller?
  commit instanceof Just ?
    [
      `commit   ${commit.value.short}  ${commit.value.subject}`,
      `author   ${commit.value.authorName} <${commit.value.authorEmail}>`,
      `date     ${formatDate(commit.value.date)}`
    ]
  : [];

const renderPushNote = (m: PushMetadata): void => {
  const branchLine = m.localBranch instanceof Just ? [`branch   ${m.localBranch.value}`] : [];
  const baseLine = m.baseBranch instanceof Just ? [`base     ${m.baseBranch.value}`] : [];
  const remoteLine = m.remoteUrl instanceof Just ? [`remote   ${m.remoteUrl.value}`] : [];
  const rangeLine = m.range instanceof Just ? [`range    ${m.range.value.before}..${m.range.value.after}`] : [];

  const body = [
    ...renderCommitLines(m.commit),
    ...branchLine,
    ...baseLine,
    ...remoteLine,
    ...rangeLine,
    ...renderPrLine(m.pr)
  ].join("\n");

  if (!body) return;

  p.note(body, "Pushed");
};
