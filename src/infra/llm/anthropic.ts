export { generateContentWithAnthropic };

import Anthropic from "@anthropic-ai/sdk";

import { type Config, type AnthropicEffort } from "@/domain/config/config";
import { type GenerateContentParams } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { anthropicOAuthHeaders, CLAUDE_CODE_SYSTEM_PROMPT } from "@/infra/auth/anthropic";
import { absurd } from "@/libs/types";
import { extractResponse } from "@/domain/llm/response-parser";
import { anthropicAdaptiveParam, anthropicEnabledParam } from "@/domain/llm/effort";
import { tryWithEffort, type EffortAttempt } from "@/infra/llm/effort-fallback";
import { type Maybe } from "@/libs/maybe";

type AnthropicConfig = Extract<Config["ai"], { provider: "anthropic" }>;

type TextBlock = { type: "text"; text: string };

type Stage = "adaptive" | "enabled" | "off";

const BASE_MAX_TOKENS = 4096;

// TODO: We really need this?
const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const buildApiKeyParams = (
  model: string,
  effort: Maybe<AnthropicEffort>,
  params: GenerateContentParams,
  stage: Stage
): Anthropic.MessageCreateParamsNonStreaming => {
  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: BASE_MAX_TOKENS,
    ...(params.systemInstruction !== undefined ? { system: params.systemInstruction } : {}),
    messages: [{ role: "user", content: params.prompt }]
  };

  // TODO: That's is interesting. These both if's are wrong. We don't want the adaptive. and we don't want to verify if the effort is enabled. The effort should be ever enabled. If any effort level is set, use the "medium" or "high" as default.
  if (stage === "adaptive") {
    const adaptive = anthropicAdaptiveParam(effort);
    return adaptive ? { ...base, ...adaptive } : base;
  }
  if (stage === "enabled") {
    const enabled = anthropicEnabledParam(effort, BASE_MAX_TOKENS);
    return enabled ? { ...base, thinking: enabled.thinking, max_tokens: enabled.max_tokens } : base;
  }
  return base;
};

const buildSetupTokenParams = (
  model: string,
  effort: Maybe<AnthropicEffort>,
  params: GenerateContentParams,
  stage: Stage
): Anthropic.MessageCreateParamsNonStreaming => {
  const systemBlocks: TextBlock[] = [{ type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT }];
  if (params.systemInstruction !== undefined) {
    systemBlocks.push({ type: "text", text: params.systemInstruction });
  }

  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: BASE_MAX_TOKENS,
    system: systemBlocks,
    messages: [{ role: "user", content: params.prompt }]
  };

  if (stage === "adaptive") {
    const adaptive = anthropicAdaptiveParam(effort);
    return adaptive ? { ...base, ...adaptive } : base;
  }
  if (stage === "enabled") {
    const enabled = anthropicEnabledParam(effort, BASE_MAX_TOKENS);
    return enabled ? { ...base, thinking: enabled.thinking, max_tokens: enabled.max_tokens } : base;
  }
  return base;
};

const callAnthropicWithApiKey = (apiKey: string, model: string, effort: Maybe<AnthropicEffort>, params: GenerateContentParams): Future<Error, string> => {
  const run = (stage: Stage): Future<Error, string> =>
    Future.attemptP(async () => {
      const client = new Anthropic({ apiKey });
      return await client.messages.create(buildApiKeyParams(model, effort, params, stage));
    })
      .mapRej(toError)
      .chain((response) => extractResponse({ provider: "anthropic", value: response }));

  return tryWithEffort<string>(buildAttempts(effort, run));
};

const callAnthropicWithSetupToken = (
  authToken: string,
  model: string,
  effort: Maybe<AnthropicEffort>,
  params: GenerateContentParams
): Future<Error, string> => {
  const run = (stage: Stage): Future<Error, string> =>
    Future.attemptP(async () => {
      const client = new Anthropic({
        apiKey: null,
        authToken,
        defaultHeaders: anthropicOAuthHeaders()
      });
      return await client.messages.create(buildSetupTokenParams(model, effort, params, stage));
    })
      .mapRej(toError)
      .chain((response) => extractResponse({ provider: "anthropic", value: response }));

  return tryWithEffort<string>(buildAttempts(effort, run));
};

const buildAttempts = (
  effort: Maybe<AnthropicEffort>,
  run: (stage: Stage) => Future<Error, string>
): readonly [EffortAttempt<string>, ...EffortAttempt<string>[]] =>
  anthropicAdaptiveParam(effort) !== undefined ? [() => run("adaptive"), () => run("enabled"), () => run("off")] : [() => run("off")];

const generateContentWithAnthropic = (config: AnthropicConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return callAnthropicWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "anthropic_setup_token":
      return callAnthropicWithSetupToken(config.auth_method.content, config.model, config.effort, params);
    case "google_oauth":
    case "openai_oauth":
      return Future.reject(new Error(`Unsupported auth method for Anthropic: ${config.auth_method.type}`));
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
