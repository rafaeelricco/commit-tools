export {
  type GenerateContentParams,
  type GeneratedContent,
  type LlmRequestMetadata,
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

type LlmRequestMetadata = {
  readonly durationMs: number;
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

const withRequestMetadata = (f: Future<Error, ProviderGeneratedContent>): Future<Error, GeneratedContent> => {
  const startedAt = Date.now();
  return f.map(({ text, tokens }) => ({
    text,
    metadata: {
      durationMs: Date.now() - startedAt,
      tokens
    }
  }));
};

const generateContent = (config: ProviderConfig, params: GenerateContentParams): Future<Error, GeneratedContent> => {
  switch (config.provider) {
    case "gemini":
      return withRequestMetadata(generateContentWithGemini(config, params));
    case "openai":
      return withRequestMetadata(generateContentWithOpenAI(config, params));
    case "anthropic":
      return withRequestMetadata(generateContentWithAnthropic(config, params));
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
