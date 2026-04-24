export { generateContentWithOpenAI };

import OpenAI from "openai";

import { type Config, type OpenAITokens, type OpenAIEffort } from "@/domain/config/config";
import { type GenerateContentParams } from "@/domain/llm/router";
import { Future } from "@/libs/future";
import { getOpenAIAccessToken } from "@/infra/auth/openai";
import { extractResponse } from "@/domain/llm/response-parser";
import { openaiReasoningParam } from "@/domain/llm/effort";
import { tryWithEffort, type EffortAttempt } from "@/infra/llm/effort-fallback";
import { type Maybe } from "@/libs/maybe";

type OpenAIConfig = Extract<Config["ai"], { provider: "openai" }>;

const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const callOpenAIWithApiKey = (authToken: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): Future<Error, string> => {
  const run = (withReasoning: boolean): Future<Error, string> =>
    Future.attemptP(async () => {
      const client = new OpenAI({ apiKey: authToken });
      const reasoning = withReasoning ? openaiReasoningParam(effort) : undefined;
      return await client.responses.create({
        model,
        instructions: params.systemInstruction ?? null,
        input: params.prompt,
        // TODO: we need to avoid use this "{}" object;
        ...(reasoning ?? {})
      });
    })
      .mapRej(toError)
      .chain((response) => extractResponse({ provider: "openai", source: "direct", value: response }));

  // TODO: the implementation is not good if we need to do attempts to return some response. Remove this attempt and also think in a way to do this type-safe, no helpers and do the calls via SDK instead of REST, that way we can have better types and avoid all this "tryWithEffort" and "EffortAttempt" and "Maybe" and all that. We just need a simple function that tries to call the API with different parameters until it succeeds or runs out of options.
  const attempts: readonly [EffortAttempt<string>, ...EffortAttempt<string>[]] =
    openaiReasoningParam(effort) !== undefined ? [() => run(true), () => run(false)] : [() => run(false)];

  return tryWithEffort<string>(attempts);
};

const callOpenAIWithOAuth = (authToken: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): Future<Error, string> => {
  const run = (withReasoning: boolean): Future<Error, string> =>
    Future.attemptP(async () => {
      const client = new OpenAI({
        baseURL: "https://chatgpt.com/backend-api/codex",
        apiKey: authToken
      });

      const reasoning = withReasoning ? openaiReasoningParam(effort) : undefined;

      const stream = client.responses.stream({
        model,
        instructions: params.systemInstruction ?? "",
        input: [{ role: "user", content: params.prompt }],
        store: false,
        // TODO: we need to avoid use this "{}" object;
        ...(reasoning ?? {})
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

  // TODO: the implementation is not good if we need to do attempts to return some response. Remove this attempt and also think in a way to do this type-safe, no helpers and do the calls via SDK instead of REST, that way we can have better types and avoid all this "tryWithEffort" and "EffortAttempt" and "Maybe" and all that. We just need a simple function that tries to call the API with different parameters until it succeeds or runs out of options.
  const attempts: readonly [EffortAttempt<string>, ...EffortAttempt<string>[]] =
    openaiReasoningParam(effort) !== undefined ? [() => run(true), () => run(false)] : [() => run(false)];

  return tryWithEffort<string>(attempts);
};

const generateContentWithApiKey = (apiKey: string, model: string, effort: Maybe<OpenAIEffort>, params: GenerateContentParams): Future<Error, string> =>
  callOpenAIWithApiKey(apiKey, model, effort, params);

const generateContentWithOAuth = (
  tokens: OpenAITokens,
  model: string,
  effort: Maybe<OpenAIEffort>,
  params: GenerateContentParams
): Future<Error, string> => getOpenAIAccessToken(tokens).chain((accessToken) => callOpenAIWithOAuth(accessToken, model, effort, params));

const generateContentWithOpenAI = (config: OpenAIConfig, params: GenerateContentParams): Future<Error, string> => {
  switch (config.auth_method.type) {
    case "api_key":
      return generateContentWithApiKey(config.auth_method.content, config.model, config.effort, params);
    case "openai_oauth":
      return generateContentWithOAuth(config.auth_method.content, config.model, config.effort, params);
    default:
      return Future.reject(new Error(`Unsupported auth method for OpenAI: ${config.auth_method.type}`));
  }
};
