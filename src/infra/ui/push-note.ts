export { renderPushNote, type PushMetadata };

import * as p from "@clack/prompts";

import { type CommitMetadata, type PushRange } from "@/infra/git/repo";
import { Just, type Maybe } from "@/libs/maybe";

type PushMetadata = {
  commit: CommitMetadata;
  localBranch: string;
  upstream: Maybe<string>;
  remoteUrl: string;
  range: Maybe<PushRange>;
};

const formatDate = (d: Date): string => d.toISOString().slice(0, 16).replace("T", " ");

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
    ...rangeLine
  ].join("\n");

  p.note(body, "Pushed");
};
