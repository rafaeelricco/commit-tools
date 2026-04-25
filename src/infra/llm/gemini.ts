export { type GeminiAuthCredentials, generateContentWithGemini, getAuthCredentials };

import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";

import { Future } from "@/libs/future";
import { type Config, type OAuthTokens, type GeminiEffort } from "@/domain/config/config";
import { getAccessToken } from "@/infra/auth/google";
import { Just, Nothing, fromOptional, type Maybe } from "@/libs/maybe";
import { type GenerateContentParams } from "@/domain/llm/router";
import { extractResponse } from "@/domain/llm/response-parser";
import { geminiLevelConfig, geminiBudgetConfig } from "@/domain/llm/effort";
import { tryWithEffort, type EffortAttempt } from "@/infra/llm/effort-fallback";

type GeminiConfig = Extract<Config["ai"], { provider: "gemini" }>;

type GeminiAuthCredentials = { readonly method: "api_key"; readonly apiKey: string } | { readonly method: "google_oauth"; readonly tokens: OAuthTokens };

type Stage = "level" | "budget" | "off";

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

const buildConfigForStage = (effort: Maybe<GeminiEffort>, params: GenerateContentParams, stage: Stage): GenerateContentConfig => {
  const base: GenerateContentConfig = {};
  if (params.systemInstruction !== undefined) base.systemInstruction = params.systemInstruction;
  if (stage === "level") Object.assign(base, geminiLevelConfig(effort));
  if (stage === "budget") Object.assign(base, geminiBudgetConfig(effort));
  return base;
};

const buildAttempts = (
  effort: Maybe<GeminiEffort>,
  run: (stage: Stage) => Future<Error, string>
): readonly [EffortAttempt<string>, ...EffortAttempt<string>[]] =>
  geminiLevelConfig(effort) !== undefined ? [() => run("level"), () => run("budget"), () => run("off")] : [() => run("off")];

const generateContentWithApiKey = (apiKey: string, model: string, effort: Maybe<GeminiEffort>, params: GenerateContentParams): Future<Error, string> => {
  const run = (stage: Stage): Future<Error, string> =>
    Future.attemptP(async () => {
      const ai = new GoogleGenAI({ apiKey });
      const config = buildConfigForStage(effort, params, stage);
      return await ai.models.generateContent({ model, contents: params.prompt, config });
    })
      .mapRej(toError)
      .chain((result) => extractResponse({ text: fromOptional(result.text) }));

  return tryWithEffort<string>(buildAttempts(effort, run));
};

const buildOAuthBody = (effort: Maybe<GeminiEffort>, params: GenerateContentParams, stage: Stage): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: params.prompt }] }]
  };

  if (params.systemInstruction !== undefined) {
    body["system_instruction"] = { parts: [{ text: params.systemInstruction }] };
  }

  // TODO: maybe we don't need to check any of this, we could have a default set for each.
  const levelCfg = stage === "level" ? geminiLevelConfig(effort) : undefined;
  const budgetCfg = stage === "budget" ? geminiBudgetConfig(effort) : undefined;
  const thinking = levelCfg ?? budgetCfg;
  if (thinking) body["generationConfig"] = { thinkingConfig: thinking.thinkingConfig };

  return body;
};

const generateContentWithOAuth = (
  tokens: OAuthTokens,
  model: string,
  effort: Maybe<GeminiEffort>,
  params: GenerateContentParams
): Future<Error, string> =>
  getAccessToken(tokens).chain((accessToken) => {
    const run = (stage: Stage): Future<Error, string> =>
      Future.attemptP(async () => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildOAuthBody(effort, params, stage))
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
        }

        // TODO: Remove the type-cast and review the types of this, and try to move this to use via SDK;
        return (await response.json()) as {
          promptFeedback?: unknown;
          usageMetadata?: unknown;
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
      })
        .mapRej(toError)
        .chain((json) => extractResponse({ text: fromOptional(json.candidates?.[0]?.content?.parts?.[0]?.text) }));

    return tryWithEffort<string>(buildAttempts(effort, run));
  });

const generateContentWithGemini = (config: GeminiConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return generateContentWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "google_oauth":
      return generateContentWithOAuth(config.auth_method.content, config.model, config.effort, params);
    default:
      return Future.reject(new Error(`Unsupported auth method for Gemini: ${config.auth_method.type}`));
  }
};
