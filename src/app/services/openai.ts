export { generateContentWithOpenAI };

import { type Config, type OpenAITokens } from "@/app/services/config";
import { type GenerateContentParams } from "@/app/services/llm";
import { Future } from "@/libs/future";
import { getOpenAIAccessToken } from "@/app/services/openaiAuth";

import OpenAI from "openai";

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;

const callOpenAIWithApiKey = (authToken: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ apiKey: authToken });
    const response = await client.responses.create({
      model,
      instructions: params.systemInstruction ?? null,
      input: params.prompt
    });
    const text = response.output_text;
    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej((e) => new Error(String(e)));

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

    const response = await stream.finalResponse();

    const text = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .map((c) => (c.type === "output_text" ? c.text : ""))
      .join("");

    if (!text.trim()) throw new Error("Empty AI response");

    return text.trim();
  }).mapRej((e) => new Error(String(e)));

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
