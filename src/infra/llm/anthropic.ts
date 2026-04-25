export { generateContentWithAnthropic };

import Anthropic from "@anthropic-ai/sdk";

import { type Config, type AnthropicEffort } from "@/domain/config/config";
import { type GenerateContentParams } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { anthropicOAuthHeaders, CLAUDE_CODE_SYSTEM_PROMPT } from "@/infra/auth/anthropic";
import { absurd } from "@/libs/types";
import { extractResponse } from "@/domain/llm/response-parser";
import { unsupportedAuth } from "@/domain/llm/auth-error";
import { Just, fromOptional, type Maybe } from "@/libs/maybe";

type AnthropicConfig = Extract<Config["ai"], { provider: "anthropic" }>;
type SystemParam = NonNullable<Anthropic.MessageStreamParams["system"]>;

const BASE_MAX_TOKENS = 16384;

const extractAnthropicText = (content: Anthropic.ContentBlock[]): string =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

const buildParams = (
  model: string,
  system: Maybe<SystemParam>,
  effort: Maybe<AnthropicEffort>,
  params: GenerateContentParams
): Anthropic.MessageStreamParams => {
  const core: Anthropic.MessageStreamParams = {
    model,
    max_tokens: BASE_MAX_TOKENS,
    messages: [{ role: "user", content: params.prompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: effort.withDefault("medium") }
  };
  return system.maybe(core, (s) => ({ ...core, system: s }));
};

const buildSetupTokenSystem = (instruction: Maybe<string>): SystemParam =>
  instruction.maybe<Anthropic.TextBlockParam[]>([{ type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT }], (text) => [
    { type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT },
    { type: "text", text }
  ]);

const callAnthropicWithApiKey = (apiKey: string, model: string, effort: Maybe<AnthropicEffort>, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream(buildParams(model, fromOptional(params.systemInstruction), effort, params));
    return await stream.finalMessage();
  })
    .mapRej((error) => new Error(`Failed to create Anthropic message: ${error instanceof Error ? error.message : String(error)}`))
    .chain((message) => extractResponse({ text: Just(extractAnthropicText(message.content)) }));

const callAnthropicWithSetupToken = (
  authToken: string,
  model: string,
  effort: Maybe<AnthropicEffort>,
  params: GenerateContentParams
): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new Anthropic({
      apiKey: null,
      authToken,
      defaultHeaders: anthropicOAuthHeaders()
    });
    const system = Just<SystemParam>(buildSetupTokenSystem(fromOptional(params.systemInstruction)));
    const stream = client.messages.stream(buildParams(model, system, effort, params));
    return await stream.finalMessage();
  })
    .mapRej((error) => new Error(`Failed to create Anthropic message: ${error instanceof Error ? error.message : String(error)}`))
    .chain((message) => extractResponse({ text: Just(extractAnthropicText(message.content)) }));

const generateContentWithAnthropic = (config: AnthropicConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return callAnthropicWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "anthropic_setup_token":
      return callAnthropicWithSetupToken(config.auth_method.content, config.model, config.effort, params);
    case "google_oauth":
    case "openai_oauth":
      return unsupportedAuth("anthropic", config.auth_method.type);
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
