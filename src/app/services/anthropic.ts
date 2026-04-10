export { generateContentWithAnthropic };

import Anthropic from "@anthropic-ai/sdk";

import { type Config } from "@/domain/config/config";
import { type GenerateContentParams } from "@/app/services/llm";
import { Future } from "@/libs/future";
import { anthropicOAuthHeaders, CLAUDE_CODE_SYSTEM_PROMPT } from "@/lib/auth/anthropic";

type AnthropicConfig = Extract<Config["ai"], { provider: "anthropic" }>;

type TextBlock = { type: "text"; text: string };

const MAX_TOKENS = 4096;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const extractText = (content: Array<{ type: string; text?: string }>): string =>
  content
    .filter((block): block is TextBlock => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");

const callAnthropicWithApiKey = (apiKey: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      ...(params.systemInstruction !== undefined ? { system: params.systemInstruction } : {}),
      messages: [{ role: "user", content: params.prompt }]
    });

    const text = extractText(response.content);
    if (!text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej(toError);

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

    const systemBlocks: TextBlock[] = [
      { type: "text", text: CLAUDE_CODE_SYSTEM_PROMPT },
      ...(params.systemInstruction !== undefined ? [{ type: "text" as const, text: params.systemInstruction }] : [])
    ];

    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: [{ role: "user", content: params.prompt }]
    });

    const text = extractText(response.content);
    if (!text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej(toError);

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
    default: {
      const _exhaustiveCheck: never = config.auth_method;
      return Future.reject(new Error(`Unknown auth method: ${JSON.stringify(_exhaustiveCheck)}`));
    }
  }
};
