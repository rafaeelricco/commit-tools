export { generateContentWithAnthropic };

import Anthropic from "@anthropic-ai/sdk";

import { type Config } from "@/domain/config/config";
import { type GenerateContentParams } from "@/app/services/llm";
import { Future } from "@/libs/future";
import { anthropicOAuthHeaders, CLAUDE_CODE_SYSTEM_PROMPT } from "@/lib/auth/anthropic";
import { absurd } from "@/libs/types";
import { extractResponse } from "@/domain/provider/responseParser";

type AnthropicConfig = Extract<Config["ai"], { provider: "anthropic" }>;

type TextBlock = { type: "text"; text: string };

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const callAnthropicWithApiKey = (apiKey: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new Anthropic({ apiKey });

    return await client.messages.create({
      model,
      max_tokens: 4096,
      ...(params.systemInstruction !== undefined ? { system: params.systemInstruction } : {}),
      messages: [{ role: "user", content: params.prompt }]
    });
  })
    .mapRej(toError)
    .chain((response) => extractResponse({ provider: "anthropic", value: response }));

const callAnthropicWithSetupToken = (
  authToken: string,
  model: string,
  params: GenerateContentParams
): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new Anthropic({
      apiKey: null,
      authToken,
      defaultHeaders: anthropicOAuthHeaders()
    });

    const systemBlocks: TextBlock[] = [{ type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT }];

    if (params.systemInstruction !== undefined) {
      systemBlocks.push({ type: "text", text: params.systemInstruction });
    }

    return await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemBlocks,
      messages: [{ role: "user", content: params.prompt }]
    });
  })
    .mapRej(toError)
    .chain((response) => extractResponse({ provider: "anthropic", value: response }));

const generateContentWithAnthropic = (
  config: AnthropicConfig,
  params: GenerateContentParams
): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return callAnthropicWithApiKey(config.auth_method.content, config.model, params);
    case "anthropic_setup_token":
      return callAnthropicWithSetupToken(config.auth_method.content, config.model, params);
    case "google_oauth":
    case "openai_oauth":
      return Future.reject(new Error(`Unsupported auth method for Anthropic: ${config.auth_method.type}`));
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
