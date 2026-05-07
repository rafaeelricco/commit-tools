export { type GeminiAuthCredentials, generateContentWithGemini, getAuthCredentials };

import { GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type GenerateContentResponse, type GenerationConfig } from "@google/genai";

import { type Config, type OAuthTokens, type GeminiEffort } from "@/domain/config/config";
import { type GenerateContentParams, type ProviderGeneratedContent, type TokenUsage } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { getAccessToken } from "@/infra/auth/google";
import { Just, Nothing, fromOptional, type Maybe } from "@/libs/maybe";
import { extractResponse } from "@/domain/llm/response-parser";
import { unsupportedAuth } from "@/domain/llm/auth-error";
import { absurd } from "@/libs/types";

type GeminiConfig = Extract<Config["ai"], { provider: "gemini" }>;
type GeminiAuthCredentials = { readonly method: "api_key"; readonly apiKey: string } | { readonly method: "google_oauth"; readonly tokens: OAuthTokens };

type OAuthRequestBody = {
  contents: Content[];
  systemInstruction?: Content;
  generationConfig?: GenerationConfig;
};

const toTokenUsage = (usage: GenerateContentResponse["usageMetadata"]): Maybe<TokenUsage> =>
  fromOptional(usage).map((u) => ({
    input: fromOptional(u.promptTokenCount),
    output: fromOptional(u.candidatesTokenCount),
    total: fromOptional(u.totalTokenCount)
  }));

const getAuthCredentials = (config: Config): Maybe<GeminiAuthCredentials> => {
  switch (config.ai.auth_method.type) {
    case "google_oauth":
      return Just({ method: "google_oauth", tokens: config.ai.auth_method.content });
    case "api_key":
      return Just({ method: "api_key", apiKey: config.ai.auth_method.content });
    default:
      return Nothing();
  }
};

const buildSDKConfig = (effort: Maybe<GeminiEffort>, params: GenerateContentParams): GenerateContentConfig => {
  const core: GenerateContentConfig = {
    thinkingConfig: { thinkingLevel: effort.withDefault(ThinkingLevel.MEDIUM) }
  };
  return fromOptional(params.systemInstruction).maybe(core, (s) => ({ ...core, systemInstruction: s }));
};

const buildOAuthBody = (effort: Maybe<GeminiEffort>, params: GenerateContentParams): OAuthRequestBody => {
  const core: OAuthRequestBody = {
    contents: [{ parts: [{ text: params.prompt }] }],
    generationConfig: { thinkingConfig: { thinkingLevel: effort.withDefault(ThinkingLevel.MEDIUM) } }
  };
  return fromOptional(params.systemInstruction).maybe(core, (s) => ({ ...core, systemInstruction: { parts: [{ text: s }] } }));
};

const extractSSEEvent = (event: string): ProviderGeneratedContent => {
  const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) return { text: "", tokens: Nothing() };
  const json = JSON.parse(dataLine.slice(6)) as GenerateContentResponse;
  return {
    text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
    tokens: toTokenUsage(json.usageMetadata)
  };
};

const accumulateSSEContent = async (response: Response): Promise<ProviderGeneratedContent> => {
  if (!response.ok) throw new Error(`Gemini API error (${response.status}): ${await response.text()}`);
  if (!response.body) throw new Error("Gemini stream returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let tokens: Maybe<TokenUsage> = Nothing();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const chunk = extractSSEEvent(ev);
      text += chunk.text;
      tokens = chunk.tokens.alt(tokens);
    }
  }
  return { text, tokens };
};

const generateContentWithApiKey = (
  apiKey: string,
  model: string,
  effort: Maybe<GeminiEffort>,
  params: GenerateContentParams
): Future<Error, ProviderGeneratedContent> =>
  Future.attemptP(async () => {
    const ai = new GoogleGenAI({ apiKey });
    const stream = await ai.models.generateContentStream({ model, contents: params.prompt, config: buildSDKConfig(effort, params) });
    let text = "";
    let tokens: Maybe<TokenUsage> = Nothing();
    for await (const chunk of stream) {
      if (chunk.text) text += chunk.text;
      tokens = toTokenUsage(chunk.usageMetadata).alt(tokens);
    }
    return { text, tokens };
  })
    .mapRej((error) => new Error(`Failed to create Gemini content: ${error instanceof Error ? error.message : String(error)}`))
    .chain((content) => extractResponse({ text: fromOptional(content.text) }).map((text) => ({ ...content, text })));

const generateContentWithOAuth = (
  tokens: OAuthTokens,
  model: string,
  effort: Maybe<GeminiEffort>,
  params: GenerateContentParams
): Future<Error, ProviderGeneratedContent> =>
  getAccessToken(tokens).chain((accessToken) =>
    Future.attemptP(async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildOAuthBody(effort, params))
      });
      return await accumulateSSEContent(response);
    })
      .mapRej((error) => new Error(`Failed to create Gemini content: ${error instanceof Error ? error.message : String(error)}`))
      .chain((content) => extractResponse({ text: fromOptional(content.text) }).map((text) => ({ ...content, text })))
  );

const generateContentWithGemini = (config: GeminiConfig, params: GenerateContentParams): Future<Error, ProviderGeneratedContent> => {
  switch (config.auth_method.type) {
    case "api_key":
      return generateContentWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "google_oauth":
      return generateContentWithOAuth(config.auth_method.content, config.model, config.effort, params);
    case "openai_oauth":
    case "anthropic_setup_token":
      return unsupportedAuth("gemini", config.auth_method.type);
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
