export { generateContentWithOpenAI };

import OpenAI from "openai";

import { type Config, type OpenAIEffort } from "@/domain/config/config";
import { type GenerateContentParams } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { getOpenAIAccessToken } from "@/infra/auth/openai";
import { extractResponse } from "@/domain/llm/response-parser";
import { unsupportedAuth } from "@/domain/llm/auth-error";
import { absurd } from "@/libs/types";
import { fromOptional, type Maybe } from "@/libs/maybe";

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;
type StreamBundle = {
  response: OpenAI.Responses.Response;
  doneEventText: string;
  deltaSnapshotText: string;
};

const extractStreamText = (bundle: StreamBundle): Maybe<string> => {
  const fromOutput = bundle.response.output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .map((c) => (c.type === "output_text" ? c.text : ""))
    .join("");

  const candidates = [fromOutput, bundle.response.output_text, bundle.doneEventText, bundle.deltaSnapshotText];
  return fromOptional(candidates.find((v): v is string => typeof v === "string" && v.trim().length > 0));
};

const openaiReasoning = (effort: Maybe<OpenAIEffort>): Maybe<OpenAI.Reasoning> => effort.map((e) => ({ effort: e }));

const buildApiKeyParams = (
  model: string,
  effort: Maybe<OpenAIEffort>,
  params: GenerateContentParams
): OpenAI.Responses.ResponseCreateParamsNonStreaming => {
  const core: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model,
    instructions: params.systemInstruction ?? null,
    input: params.prompt
  };
  return openaiReasoning(effort).maybe(core, (r) => ({ ...core, reasoning: r }));
};

const buildOAuthParams = (model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): OpenAI.Responses.ResponseCreateParamsStreaming => {
  const core: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model,
    instructions: params.systemInstruction ?? "",
    input: [{ role: "user", content: params.prompt }],
    store: false,
    stream: true
  };
  return openaiReasoning(effort).maybe(core, (r) => ({ ...core, reasoning: r }));
};

const callOpenAIWithApiKey = (apiKey: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ apiKey });
    return await client.responses.create(buildApiKeyParams(model, effort, params));
  })
    .mapRej((error) => new Error(`Failed to create OpenAI response: ${error instanceof Error ? error.message : String(error)}`))
    .chain((response) => extractResponse({ text: fromOptional(response.output_text) }));

const callOpenAIWithOAuth = (authToken: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): Future<Error, string> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ baseURL: "https://chatgpt.com/backend-api/codex", apiKey: authToken });
    const stream = client.responses.stream(buildOAuthParams(model, effort, params));

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
    .mapRej((error) => new Error(`Failed to create OpenAI response: ${error instanceof Error ? error.message : String(error)}`))
    .chain((bundle) => extractResponse({ text: extractStreamText(bundle) }));

const generateContentWithOpenAI = (config: OpenAIConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return callOpenAIWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "openai_oauth":
      return getOpenAIAccessToken(config.auth_method.content).chain((accessToken) =>
        callOpenAIWithOAuth(accessToken, config.model, config.effort, params)
      );
    case "google_oauth":
    case "anthropic_setup_token":
      return unsupportedAuth("openai", config.auth_method.type);
    default:
      return absurd(config.auth_method, "AuthMethod");
  }
};
