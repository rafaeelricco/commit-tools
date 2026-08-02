export { generateContentWithXai };

import OpenAI, { type ClientOptions } from "openai";

import { type Config, type XaiEffort } from "@/domain/config/config";
import { type GenerateContentParams, type ProviderGeneratedContent, type TokenUsage } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { xaiApiKeyOptions } from "@/infra/auth/xai";
import { extractResponse } from "@/domain/llm/response-parser";
import { unsupportedAuth } from "@/domain/llm/auth-error";
import { absurd } from "@/libs/types";
import { Just, Nothing, fromOptional, type Maybe } from "@/libs/maybe";

type XaiConfig = Extract<Config["ai"], { provider: "xai" }>;
type Attempt = { readonly completion: OpenAI.Chat.ChatCompletion; readonly attemptedEffort: Maybe<XaiEffort> };

const toTokenUsage = (usage: OpenAI.CompletionUsage): TokenUsage => ({
  input: Just(usage.prompt_tokens),
  output: Just(usage.completion_tokens),
  total: Just(usage.total_tokens)
});

const buildMessages = (params: GenerateContentParams): OpenAI.Chat.ChatCompletionMessageParam[] =>
  fromOptional(params.systemInstruction).maybe<OpenAI.Chat.ChatCompletionMessageParam[]>([{ role: "user", content: params.prompt }], (instruction) => [
    { role: "system", content: instruction },
    { role: "user", content: params.prompt }
  ]);

const buildParams = (model: string, effort: Maybe<XaiEffort>, params: GenerateContentParams): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming => {
  const core: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = { model, messages: buildMessages(params) };
  return effort.maybe(core, (reasoning_effort) => ({ ...core, reasoning_effort }));
};

/** Grok accepts `reasoning_effort` on some models and rejects it on the rest, and `/v1/models` does not say which. */
const isUnsupportedEffort = (error: unknown): boolean => error instanceof OpenAI.BadRequestError && /reasoning_effort/i.test(error.message);

const requestCompletion = async (client: OpenAI, model: string, effort: Maybe<XaiEffort>, params: GenerateContentParams): Promise<Attempt> => {
  const attempt = async (attemptedEffort: Maybe<XaiEffort>): Promise<Attempt> => ({
    completion: await client.chat.completions.create(buildParams(model, attemptedEffort, params)),
    attemptedEffort
  });

  try {
    return await attempt(effort);
  } catch (error) {
    if (effort instanceof Nothing || !isUnsupportedEffort(error)) throw error;
    return await attempt(Nothing<XaiEffort>());
  }
};

const callXai = (
  options: ClientOptions,
  model: string,
  effort: Maybe<XaiEffort>,
  params: GenerateContentParams
): Future<Error, ProviderGeneratedContent> =>
  Future.attemptP(() => requestCompletion(new OpenAI(options), model, effort, params))
    .mapRej((error) => new Error(`Failed to create xAI completion: ${error instanceof Error ? error.message : String(error)}`, { cause: error }))
    .chain(({ completion, attemptedEffort }) =>
      extractResponse({ text: fromOptional(completion.choices[0]?.message?.content ?? undefined) }).map((text) => ({
        text,
        tokens: fromOptional(completion.usage).map(toTokenUsage),
        effectiveEffort: Just(attemptedEffort.maybe<string>("provider default", (value) => value))
      }))
    );

const generateContentWithXai = (config: XaiConfig, params: GenerateContentParams): Future<Error, ProviderGeneratedContent> => {
  switch (config.auth_method.type) {
    case "api_key":
      return callXai(xaiApiKeyOptions(config.auth_method.content), config.model, config.effort, params);
    case "google_oauth":
    case "openai_oauth":
    case "anthropic_setup_token":
      return unsupportedAuth("xai", config.auth_method.type);
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
