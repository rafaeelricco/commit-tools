export {
  type GenerateContentParams,
  type GeneratedContent,
  type LlmRequestMetadata,
  type ModelRequestMetadata,
  type ProviderGeneratedContent,
  type TokenUsage,
  type BranchNameSuggestions,
  type BranchSuggestion,
  generateCommitMessage,
  refineCommitMessage,
  generateBranchNameSuggestions,
  generateSplitPlan,
  type SplitPlanContent
};

import { Future } from "@/libs/future";
import { type Result } from "@/libs/result";
import { type ProviderConfig, type CommitConvention } from "@/domain/config/config";
import { generateContentWithGemini } from "@/infra/llm/gemini";
import { generateContentWithOpenAI } from "@/infra/llm/openai";
import { generateContentWithAnthropic } from "@/infra/llm/anthropic";
import { generateContentWithXai } from "@/infra/llm/xai";
import { getPrompt, getRefinePrompt, getBranchNamePrompt, getSplitPrompt } from "@/domain/commit/prompts";
import { parseAndValidateBranchSuggestions, type BranchSuggestion } from "@/domain/branch/suggestions";
import { parseAndValidateSplitPlan, type SplitPlan } from "@/domain/split/plan";
import { withTransientRetry } from "@/domain/llm/retry";
import { Maybe, Nothing } from "@/libs/maybe";

type GenerateContentParams = {
  readonly prompt: string;
  readonly systemInstruction?: string;
};

type TokenUsage = {
  readonly input: Maybe<number>;
  readonly output: Maybe<number>;
  readonly total: Maybe<number>;
};

type ModelRequestMetadata = {
  readonly provider: ProviderConfig["provider"];
  readonly model: string;
  readonly effort: string;
};

type LlmRequestMetadata = {
  readonly durationMs: number;
  readonly model: ModelRequestMetadata;
  readonly tokens: Maybe<TokenUsage>;
};

type GeneratedContent = {
  readonly text: string;
  readonly metadata: LlmRequestMetadata;
};

type BranchNameSuggestions = {
  readonly names: readonly [BranchSuggestion, BranchSuggestion, BranchSuggestion];
  readonly metadata: LlmRequestMetadata;
};

type SplitPlanContent = { readonly plan: SplitPlan; readonly metadata: LlmRequestMetadata };

type ProviderGeneratedContent = {
  readonly text: string;
  readonly tokens: Maybe<TokenUsage>;
  readonly effectiveEffort: Maybe<string>;
};

const modelRequestMetadata = (config: ProviderConfig, effectiveEffort: Maybe<string>): ModelRequestMetadata => {
  switch (config.provider) {
    case "openai":
    case "xai":
      return {
        provider: config.provider,
        model: config.model,
        effort: effectiveEffort.withDefault(config.effort.maybe<string>("provider default", (effort) => effort))
      };
    case "gemini":
    case "anthropic":
      return {
        provider: config.provider,
        model: config.model,
        effort: effectiveEffort.withDefault(config.effort.maybe<string>("medium", (effort) => effort))
      };
  }
};

const withRequestMetadata = (config: ProviderConfig, f: Future<Error, ProviderGeneratedContent>): Future<Error, GeneratedContent> => {
  const startedAt = Date.now();
  return f.map(({ text, tokens, effectiveEffort }) => ({
    text,
    metadata: {
      durationMs: Date.now() - startedAt,
      model: modelRequestMetadata(config, effectiveEffort),
      tokens
    }
  }));
};

const generateContent = (config: ProviderConfig, params: GenerateContentParams): Future<Error, GeneratedContent> => {
  switch (config.provider) {
    case "gemini":
      return withRequestMetadata(config, generateContentWithGemini(config, params));
    case "openai":
      return withRequestMetadata(config, generateContentWithOpenAI(config, params));
    case "anthropic":
      return withRequestMetadata(config, generateContentWithAnthropic(config, params));
    case "xai":
      return withRequestMetadata(config, generateContentWithXai(config, params));
  }
};

const generateCommitMessage = (
  config: ProviderConfig,
  diff: string,
  convention: CommitConvention,
  customTemplate: Maybe<string> = Nothing()
): Future<Error, GeneratedContent> => withTransientRetry(() => generateContent(config, { prompt: getPrompt(diff, convention, customTemplate) }));

const refineCommitMessage = (config: ProviderConfig, currentMessage: string, adjustment: string, diff: string): Future<Error, GeneratedContent> =>
  withTransientRetry(() => generateContent(config, getRefinePrompt({ diff, currentMessage, adjustment })));

const resultToFuture = <T>(r: Result<Error, T>): Future<Error, T> =>
  r.either(
    (err) => Future.reject(err),
    (value) => Future.resolve(value)
  );

const generateBranchNameSuggestions = (config: ProviderConfig, context: string): Future<Error, BranchNameSuggestions> =>
  withTransientRetry(() =>
    generateContent(config, { prompt: getBranchNamePrompt(context) }).chain((gc) =>
      resultToFuture(parseAndValidateBranchSuggestions(gc.text)).map((names) => ({
        names,
        metadata: gc.metadata
      }))
    )
  );

const generateSplitPlan = (
  config: ProviderConfig,
  diff: string,
  files: readonly string[],
  convention: CommitConvention,
  customTemplate: Maybe<string>
): Future<Error, SplitPlanContent> =>
  withTransientRetry(() =>
    generateContent(config, { prompt: getSplitPrompt(diff, files, convention, customTemplate) }).chain((gc) =>
      resultToFuture(parseAndValidateSplitPlan(gc.text, files)).map((plan) => ({ plan, metadata: gc.metadata }))
    )
  );
