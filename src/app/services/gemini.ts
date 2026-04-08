export { type GeminiAuthCredentials, generateContentWithGemini, getAuthCredentials };

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Future } from "@/libs/future";
import { type Config, type OAuthTokens } from "@/domain/config/config";
import { getAccessToken } from "@/lib/auth/google";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type GenerateContentParams } from "@/app/services/llm";
import { debugError, debugLog } from "@/libs/debug";

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
  debugLog("gemini.api_key.request", {
    provider: "gemini",
    authMethod: "api_key",
    model,
    promptLength: params.prompt.length,
    hasSystemInstruction: params.systemInstruction !== undefined
  });

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    ...(params.systemInstruction !== undefined ? { systemInstruction: params.systemInstruction } : {})
  });

  return Future.attemptP(async () => {
    const result = await geminiModel.generateContent(params.prompt);
    debugLog("gemini.api_key.response", result.response);

    const text = result.response.text() ?? "";
    debugLog("gemini.api_key.extraction", {
      textLength: text.length,
      candidates: result.response.candidates ?? [],
      promptFeedback: result.response.promptFeedback ?? null,
      usageMetadata: result.response.usageMetadata ?? null
    });

    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej((e) => {
    debugError("gemini.api_key.error", e);
    return toError(e);
  });
};

const generateContentWithOAuth = (
  tokens: OAuthTokens,
  model: string,
  params: GenerateContentParams
): Future<Error, string> =>
  getAccessToken(tokens).chain((accessToken) =>
    Future.attemptP(async () => {
      debugLog("gemini.oauth.request", {
        provider: "gemini",
        authMethod: "google_oauth",
        model,
        promptLength: params.prompt.length,
        hasSystemInstruction: params.systemInstruction !== undefined
      });

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

      debugLog("gemini.oauth.http", {
        status: response.status,
        ok: response.ok,
        model
      });

      if (!response.ok) {
        const errorBody = await response.text();
        debugLog("gemini.oauth.error_body", errorBody);
        throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
      }

      const json = (await response.json()) as {
        promptFeedback?: unknown;
        usageMetadata?: unknown;
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      debugLog("gemini.oauth.response", json);

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      debugLog("gemini.oauth.extraction", {
        textLength: text?.length ?? 0,
        candidates: json.candidates ?? [],
        promptFeedback: json.promptFeedback ?? null,
        usageMetadata: json.usageMetadata ?? null
      });

      if (!text || !text.trim()) {
        throw new Error("Empty AI response");
      }

      return text.trim();
    }).mapRej((e) => {
      debugError("gemini.oauth.error", e);
      return toError(e);
    })
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
