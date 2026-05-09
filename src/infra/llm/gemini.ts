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

const extractGeminiText = (response: GenerateContentResponse): string =>
  response.text ?? response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

const toGeneratedContent = (response: GenerateContentResponse): ProviderGeneratedContent => ({
  text: extractGeminiText(response),
  tokens: toTokenUsage(response.usageMetadata)
});

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

const parseOAuthResponse = async (response: Response): Promise<ProviderGeneratedContent> => {
  if (!response.ok) throw new Error(`Gemini API error (${response.status}): ${await response.text()}`);

  // The REST OAuth path receives the same JSON wire shape that @google/genai maps
  // to GenerateContentResponse for API-key calls. Response.json() cannot prove that
  // shape to TypeScript, so this cast keeps both auth paths on one metadata mapper.
  // If this breaks, compare the REST payload with the fields used below:
  // response.text, candidates[].content.parts[].text, and usageMetadata token counts.
  return toGeneratedContent((await response.json()) as GenerateContentResponse);
};

const generateContentWithApiKey = (
  apiKey: string,
  model: string,
  effort: Maybe<GeminiEffort>,
  params: GenerateContentParams
): Future<Error, ProviderGeneratedContent> =>
  Future.attemptP(async () => {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 120_000, retryOptions: { attempts: 3 } }
    });
    const response = await ai.models.generateContent({ model, contents: params.prompt, config: buildSDKConfig(effort, params) });
    return toGeneratedContent(response);
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildOAuthBody(effort, params))
      });
      return await parseOAuthResponse(response);
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
