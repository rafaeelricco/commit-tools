export { generateContentWithOpenAI };

import { type Config, type OpenAITokens } from "@/domain/config/config";
import { type GenerateContentParams } from "@/app/services/llm";
import { Future } from "@/libs/future";
import { getOpenAIAccessToken } from "@/lib/auth/openai";

import OpenAI from "openai";

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const callOpenAIWithApiKey = (authToken: string, model: string, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ apiKey: authToken });
    const response = await client.responses.create({
      model,
      instructions: params.systemInstruction ?? null,
      input: params.prompt
    });

    const text = response.output_text ?? "";

    if (!text || !text.trim()) throw new Error("Empty AI response");
    return text.trim();
  }).mapRej(toError);

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

    const eventCounts: Record<string, number> = {};
    let createdStatus: string | null = null;
    let completedStatus: string | null = null;
    let deltaSnapshotText = "";
    let doneEventText = "";

    stream.on("event", (event) => {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
      if (event.type === "response.created") {
        createdStatus = event.response.status ?? null;
      }
      if (event.type === "response.completed") {
        completedStatus = event.response.status ?? null;
      }
    });

    stream.on("response.output_text.delta", (event) => {
      deltaSnapshotText = event.snapshot;
    });

    stream.on("response.output_text.done", (event) => {
      doneEventText = event.text;
    });

    const response = await stream.finalResponse();

    const extractedText = response.output
      .flatMap((item) => (item.type === "message" ? item.content : []))
      .map((c) => (c.type === "output_text" ? c.text : ""))
      .join("");

    const outputText = response.output_text ?? "";
    const candidates = [
      { source: "output", value: extractedText },
      { source: "output_text", value: outputText },
      { source: "done_event", value: doneEventText },
      { source: "delta_snapshot", value: deltaSnapshotText }
    ] as const;
    const selected = candidates.find((candidate) => candidate.value.trim().length > 0);
    const text = selected?.value.trim() ?? "";

    if (!text.trim()) throw new Error("Empty AI response");

    return text.trim();
  }).mapRej(toError);

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
