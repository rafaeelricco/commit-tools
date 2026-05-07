export { renderCommitNote, renderPushNote, type CommitNoteMetadata, type PushMetadata };

import * as p from "@clack/prompts";

import type { CommitMetadata, PushRange } from "@/infra/git/repo";
import type { PrLookup } from "@/infra/github/pr";
import type { LlmRequestMetadata } from "@/domain/llm/router";
import type { Maybe } from "@/libs/maybe";
import { absurd } from "@/libs/types";

type RequestMetadata = Maybe<LlmRequestMetadata>;

type CommitNoteMetadata = {
  commit: Maybe<CommitMetadata>;
  request: RequestMetadata;
};

type PushMetadata = {
  commit: Maybe<CommitMetadata>;
  localBranch: Maybe<string>;
  baseBranch: Maybe<string>;
  remoteUrl: Maybe<string>;
  range: Maybe<PushRange>;
  pr: PrLookup;
  request: RequestMetadata;
};

const formatDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

const formatDuration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

const formatNumber = (n: number): string => n.toLocaleString("en-US");

const renderModelLine = (metadata: LlmRequestMetadata): string => `model    ${metadata.model.model} with ${metadata.model.effort} effort`;

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

const renderRequestLines = (request: RequestMetadata): string[] =>
  request.maybe<string[]>([], (value) => [
    renderModelLine(value),
    `request  ${formatDuration(value.durationMs)}`,
    value.tokens.maybe(
      "tokens   unavailable",
      (tokens) =>
        `tokens   input ${tokens.input.maybe("?", formatNumber)}  output ${tokens.output.maybe("?", formatNumber)}  total ${tokens.total.maybe("?", formatNumber)}`
    )
  ]);

const renderCommitNote = (m: CommitNoteMetadata): void => {
  const body = [...renderCommitLines(m.commit), ...renderRequestLines(m.request)].join("\n");

  if (!body) return;

  p.note(body, "Committed");
};

const renderPushNote = (m: PushMetadata): void => {
  const branchLine = m.localBranch.maybe<string[]>([], (branch) => [`branch   ${branch}`]);
  const baseLine = m.baseBranch.maybe<string[]>([], (base) => [`base     ${base}`]);
  const remoteLine = m.remoteUrl.maybe<string[]>([], (url) => [`remote   ${url}`]);
  const rangeLine = m.range.maybe<string[]>([], (range) => [`range    ${range.before}..${range.after}`]);

  const body = [
    ...renderCommitLines(m.commit),
    ...branchLine,
    ...baseLine,
    ...remoteLine,
    ...rangeLine,
    ...renderRequestLines(m.request),
    ...renderPrLine(m.pr)
  ].join("\n");

  if (!body) return;

  p.note(body, "Pushed");
};
