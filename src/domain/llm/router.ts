export {
  type GenerateContentParams,
  type GeneratedContent,
  type LlmRequestMetadata,
  type ModelRequestMetadata,
  type ProviderGeneratedContent,
  type TokenUsage,
  generateCommitMessage,
  refineCommitMessage
};

import { Future } from "@/libs/future";
import { type ProviderConfig, type CommitConvention } from "@/domain/config/config";
import { generateContentWithGemini } from "@/infra/llm/gemini";
import { generateContentWithOpenAI } from "@/infra/llm/openai";
import { generateContentWithAnthropic } from "@/infra/llm/anthropic";
import { getPrompt, getRefinePrompt } from "@/domain/commit/prompts";
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

type ProviderGeneratedContent = {
  readonly text: string;
  readonly tokens: Maybe<TokenUsage>;
};

const modelRequestMetadata = (config: ProviderConfig): ModelRequestMetadata => {
  switch (config.provider) {
    case "openai":
      return { provider: config.provider, model: config.model, effort: config.effort.maybe<string>("provider default", (effort) => effort) };
    case "gemini":
    case "anthropic":
      return { provider: config.provider, model: config.model, effort: config.effort.maybe<string>("medium", (effort) => effort) };
  }
};

const withRequestMetadata = (config: ProviderConfig, f: Future<Error, ProviderGeneratedContent>): Future<Error, GeneratedContent> => {
  const startedAt = Date.now();
  return f.map(({ text, tokens }) => ({
    text,
    metadata: {
      durationMs: Date.now() - startedAt,
      model: modelRequestMetadata(config),
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
  }
};

const generateCommitMessage = (
  config: ProviderConfig,
  diff: string,
  convention: CommitConvention,
  customTemplate: Maybe<string> = Nothing()
): Future<Error, GeneratedContent> => generateContent(config, { prompt: getPrompt(diff, convention, customTemplate) });

const refineCommitMessage = (config: ProviderConfig, currentMessage: string, adjustment: string, diff: string): Future<Error, GeneratedContent> =>
  generateContent(config, getRefinePrompt({ diff, currentMessage, adjustment }));
