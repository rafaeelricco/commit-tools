export {
  CliErrorCode,
  CliError,
  cliError,
  schema_GenerateSuccess,
  schema_DoctorSuccess,
  schema_CliFailure,
  type GenerateSuccess,
  type DoctorSuccess,
  type CliErrorCode as CliErrorCodeType,
  buildGenerateSuccess,
  writeGenerateSuccess,
  writeDoctorSuccess,
  writeCliFailure,
  encodeCommitMeta,
  encodeRequestMetadata
};

import * as s from "@/libs/json/schema";
import type { LlmRequestMetadata, TokenUsage } from "@/domain/llm/router";
import type { CommitMetadata } from "@/infra/git/repo";
import { type Maybe } from "@/libs/maybe";

const CliErrorCode = {
  INVALID_FLAGS: "INVALID_FLAGS",
  NOT_GIT_REPO: "NOT_GIT_REPO",
  NO_STAGED_CHANGES: "NO_STAGED_CHANGES",
  NO_CONFIG: "NO_CONFIG",
  AUTH_FAILED: "AUTH_FAILED",
  LLM_ERROR: "LLM_ERROR",
  PUSH_NO_UPSTREAM: "PUSH_NO_UPSTREAM",
  PUSH_REJECTED: "PUSH_REJECTED"
} as const;
type CliErrorCode = (typeof CliErrorCode)[keyof typeof CliErrorCode];

class CliError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const cliError = (code: CliErrorCode, message: string): CliError => new CliError(code, message);

const schema_TokenUsage = s.object({
  input: s.nullable(s.number),
  output: s.nullable(s.number),
  total: s.nullable(s.number)
});

const schema_ModelMeta = s.object({
  provider: s.string,
  model: s.string,
  effort: s.string
});

const schema_RequestMetadata = s.object({
  durationMs: s.number,
  model: schema_ModelMeta,
  tokens: s.nullable(schema_TokenUsage)
});

const schema_GenerateActions = s.object({
  adjusted: s.boolean,
  committed: s.boolean,
  pushed: s.boolean,
  dryRun: s.boolean
});

const schema_CommitMeta = s.object({
  hash: s.string,
  short: s.string,
  subject: s.string,
  authorName: s.string,
  authorEmail: s.string,
  date: s.string
});

const schema_GenerateSuccess = s.object({
  ok: s.boolean,
  command: s.stringLiteral("generate"),
  message: s.string,
  actions: schema_GenerateActions,
  metadata: schema_RequestMetadata,
  commit: s.nullable(schema_CommitMeta)
});

type GenerateSuccess = s.Infer<typeof schema_GenerateSuccess>;

const schema_DoctorCheck = s.object({
  name: s.string,
  status: s.string,
  level: s.string,
  info: s.string
});

const schema_DoctorSuccess = s.object({
  ok: s.boolean,
  command: s.stringLiteral("doctor"),
  checks: s.array(schema_DoctorCheck),
  ready: s.boolean,
  elapsedMs: s.number
});

type DoctorSuccess = s.Infer<typeof schema_DoctorSuccess>;

const schema_CliFailure = s.object({
  ok: s.boolean,
  error: s.object({
    code: s.string,
    message: s.string
  })
});

const encodeTokenUsage = (tokens: Maybe<TokenUsage>) =>
  tokens.maybe(null, (t) => ({
    input: t.input.maybe(null, (n) => n),
    output: t.output.maybe(null, (n) => n),
    total: t.total.maybe(null, (n) => n)
  }));

const encodeRequestMetadata = (meta: LlmRequestMetadata) => ({
  durationMs: meta.durationMs,
  model: {
    provider: meta.model.provider,
    model: meta.model.model,
    effort: meta.model.effort
  },
  tokens: encodeTokenUsage(meta.tokens)
});

const encodeCommitMeta = (commit: CommitMetadata) => ({
  hash: commit.hash,
  short: commit.short,
  subject: commit.subject,
  authorName: commit.authorName,
  authorEmail: commit.authorEmail,
  date: commit.date.toISOString()
});

const buildGenerateSuccess = (input: {
  message: string;
  metadata: LlmRequestMetadata;
  adjusted: boolean;
  committed: boolean;
  pushed: boolean;
  dryRun: boolean;
  commit: Maybe<CommitMetadata>;
}): GenerateSuccess => ({
  ok: true,
  command: "generate",
  message: input.message,
  actions: {
    adjusted: input.adjusted,
    committed: input.committed,
    pushed: input.pushed,
    dryRun: input.dryRun
  },
  metadata: encodeRequestMetadata(input.metadata),
  commit: input.commit.maybe(null, encodeCommitMeta)
});

const writeGenerateSuccess = (value: GenerateSuccess): void => {
  process.stdout.write(JSON.stringify(s.encode(schema_GenerateSuccess, value)) + "\n");
};

const writeDoctorSuccess = (value: DoctorSuccess): void => {
  process.stdout.write(JSON.stringify(s.encode(schema_DoctorSuccess, value)) + "\n");
};

const writeCliFailure = (code: CliErrorCode, message: string): void => {
  process.stderr.write(JSON.stringify(s.encode(schema_CliFailure, { ok: false, error: { code, message } })) + "\n");
};
