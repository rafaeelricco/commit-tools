export { type GeminiAuthCredentials, generateContentWithGemini, getAuthCredentials };

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Future } from "@/libs/future";
import { type Config, type OAuthTokens } from "@/domain/config/config";
import { getAccessToken } from "@/lib/auth/google";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type GenerateContentParams } from "@/app/services/llm";
import { extractResponse } from "@/domain/provider/responseParser";

type GeminiConfig = Extract<Config["ai"], { provider: "gemini" }>;

type GeminiAuthCredentials =
  | { readonly method: "api_key"; readonly apiKey: string }
  | { readonly method: "google_oauth"; readonly tokens: OAuthTokens };

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const getAuthCredentials = (config: Config): Maybe<GeminiAuthCredentials> => {
  if (config.ai.provider !== "gemini") return Nothing();

  switch (config.ai.auth_method.type) {
    case "google_oauth":
      return Just({ method: "google_oauth", tokens: config.ai.auth_method.content });
    case "api_key":
      return Just({ method: "api_key", apiKey: config.ai.auth_method.content });
    default:
      return Nothing();
  }
};

const generateContentWithApiKey = (
  apiKey: string,
  model: string,
  params: GenerateContentParams
): Future<Error, string> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelParams: Parameters<typeof genAI.getGenerativeModel>[0] = { model };

  if (params.systemInstruction !== undefined) {
    modelParams.systemInstruction = params.systemInstruction;
  }

  const geminiModel = genAI.getGenerativeModel(modelParams);

  return Future.attemptP(async () => await geminiModel.generateContent(params.prompt))
    .mapRej(toError)
    .chain((result) => extractResponse({ provider: "gemini", source: "sdk", value: result }));
};

const generateContentWithOAuth = (
  tokens: OAuthTokens,
  model: string,
  params: GenerateContentParams
): Future<Error, string> =>
  getAccessToken(tokens).chain((accessToken) =>
    Future.attemptP(async () => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const contents = [{ parts: [{ text: params.prompt }] }];
      const body: Record<string, unknown> = { contents };

      if (params.systemInstruction !== undefined) {
        body["system_instruction"] = {
          parts: [{ text: params.systemInstruction }]
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
      }

      return (await response.json()) as {
        promptFeedback?: unknown;
        usageMetadata?: unknown;
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
    })
      .mapRej(toError)
      .chain((json) => extractResponse({ provider: "gemini", source: "rest", value: json }))
  );

const generateContentWithGemini = (config: GeminiConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return generateContentWithApiKey(config.auth_method.content, config.model, params);
    case "google_oauth":
      return generateContentWithOAuth(config.auth_method.content, config.model, params);
    default:
      return Future.reject(new Error(`Unsupported auth method for Gemini: ${config.auth_method.type}`));
  }
};
