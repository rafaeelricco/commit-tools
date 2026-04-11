export { generateContentWithOpenAI };

import { type Config, type OpenAITokens } from "@/domain/config/config";
import { type GenerateContentParams } from "@/app/llm/llm";
import { Future } from "@/utils/future";
import { getOpenAIAccessToken } from "@/lib/auth/openai";
import { extractResponse } from "@/domain/llm/responseParser";

import OpenAI from "openai";

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const callOpenAIWithApiKey = (authToken: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ apiKey: authToken });
    return await client.responses.create({
      model,
      instructions: params.systemInstruction ?? null,
      input: params.prompt
    });
  })
    .mapRej(toError)
    .chain((response) => extractResponse({ provider: "openai", source: "direct", value: response }));

const callOpenAIWithOAuth = (authToken: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({
      baseURL: "https://chatgpt.com/backend-api/codex",
      apiKey: authToken
    });

    const stream = client.responses.stream({
      model,
      instructions: params.systemInstruction ?? "",
      input: [{ role: "user", content: params.prompt }],
      store: false
    });

    let deltaSnapshotText = "";
    let doneEventText = "";

    stream.on("response.output_text.delta", (event) => {
      deltaSnapshotText = event.snapshot;
    });

    stream.on("response.output_text.done", (event) => {
      doneEventText = event.text;
    });

    const response = await stream.finalResponse();
    return { response, doneEventText, deltaSnapshotText };
  })
    .mapRej(toError)
    .chain((bundle) => extractResponse({ provider: "openai", source: "stream", value: bundle }));

const generateContentWithApiKey = (
  apiKey: string,
  model: string,
  params: GenerateContentParams
): Future<Error, string> => callOpenAIWithApiKey(apiKey, model, params);

const generateContentWithOAuth = (
  tokens: OpenAITokens,
  model: string,
  params: GenerateContentParams
): Future<Error, string> =>
  getOpenAIAccessToken(tokens).chain((accessToken) => callOpenAIWithOAuth(accessToken, model, params));

const generateContentWithOpenAI = (config: OpenAIConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return generateContentWithApiKey(config.auth_method.content, config.model, params);
    case "openai_oauth":
      return generateContentWithOAuth(config.auth_method.content, config.model, params);
    default:
      return Future.reject(new Error(`Unsupported auth method for OpenAI: ${config.auth_method.type}`));
  }
};
