export { fetchModels };

import { Future } from "@/libs/future";
import { OPENAI_EFFORTS, type Model, type OpenAIEffort, type OpenAIModelEffort, type ProviderConfig } from "@/domain/config/config";
import { getOpenAIAccessToken } from "@/infra/auth/openai";
import { anthropicOAuthHeaders } from "@/infra/auth/anthropic";
import { xaiApiKeyOptions, xaiOAuthOptions } from "@/infra/auth/xai";
import { unsupportedAuth } from "@/domain/llm/auth-error";
import { absurd } from "@/libs/types";
import { Just, Nothing, type Maybe } from "@/libs/maybe";

import OpenAI, { type ClientOptions } from "openai";

type CodexModel = {
  readonly slug: string;
  readonly display_name: string;
  readonly description: string;
  readonly default_reasoning_level?: string;
  readonly supported_reasoning_levels?: readonly { readonly effort: string }[];
};

const isOpenAIEffort = (value: string): value is OpenAIEffort => OPENAI_EFFORTS.some((effort) => effort === value);

const openAIEffortFor = (model: CodexModel): Maybe<OpenAIModelEffort> => {
  const [first, ...rest] = (model.supported_reasoning_levels ?? []).map(({ effort }) => effort).filter(isOpenAIEffort);
  if (first === undefined) return Nothing();

  const options: [OpenAIEffort, ...OpenAIEffort[]] = [first, ...rest];
  const defaultValue = options.find((effort) => effort === model.default_reasoning_level) ?? options.find((effort) => effort === "medium") ?? first;
  return Just({ options, defaultValue });
};

const fetchOpenAIModelsWithApiKey = (apiKey: string): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    const client = new OpenAI({ apiKey });
    const list = await client.models.list();
    const models: Array<{ id: string }> = [];
    for await (const model of list) {
      models.push(model);
    }
    return models
      .filter((m) => m.id.startsWith("gpt-") || m.id.startsWith("o"))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, description: "", openaiEffort: Nothing<OpenAIModelEffort>() }));
  });

const fetchOpenAIModelsWithOAuth = (tokens: ProviderConfig["auth_method"]["content"]): Future<Error, Model[]> =>
  getOpenAIAccessToken(tokens as Parameters<typeof getOpenAIAccessToken>[0]).chain((accessToken) =>
    Future.attemptP(async () => {
      const url = "https://chatgpt.com/backend-api/codex/models?client_version=99.99.99";
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to fetch models (${response.status}): ${body}`);
      }

      const data = (await response.json()) as { models: CodexModel[] };
      return data.models
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((m) => ({ id: m.slug, description: m.description, openaiEffort: openAIEffortFor(m) }));
    })
  );

const fetchOpenAIModels = (authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> => {
  switch (authMethod.type) {
    case "api_key":
      return fetchOpenAIModelsWithApiKey(authMethod.content);
    case "openai_oauth":
      return fetchOpenAIModelsWithOAuth(authMethod.content);
    default:
      return Future.reject(new Error(`Unsupported auth method for OpenAI: ${authMethod.type}`));
  }
};

const fetchGeminiModels = (authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    let url = "https://generativelanguage.googleapis.com/v1beta/models";
    let headers: Record<string, string> = {};

    if (authMethod.type === "api_key") {
      url += `?key=${authMethod.content}`;
    } else if (authMethod.type === "google_oauth") {
      const tokens = authMethod.content;
      headers["Authorization"] = `Bearer ${tokens.access_token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = (await response.json()) as { models?: { readonly name: string; readonly description?: string }[] };
    return (data.models || []).map((m) => ({
      id: m.name.replace("models/", ""),
      description: m.description || "",
      openaiEffort: Nothing<OpenAIModelEffort>()
    }));
  });

const fetchAnthropicModels = (authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    const url = "https://api.anthropic.com/v1/models?limit=1000";
    const headers: Record<string, string> = {
      "anthropic-version": "2023-06-01",
      Accept: "application/json"
    };

    switch (authMethod.type) {
      case "api_key":
        headers["x-api-key"] = authMethod.content;
        break;
      case "anthropic_setup_token":
        headers["Authorization"] = `Bearer ${authMethod.content}`;
        Object.assign(headers, anthropicOAuthHeaders());
        break;
      default:
        throw new Error(`Unsupported auth method for Anthropic: ${authMethod.type}`);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to fetch Anthropic models (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
    };

    return (data.data ?? [])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, description: m.display_name ?? "", openaiEffort: Nothing<OpenAIModelEffort>() }));
  });

const fetchXaiModelsWith = (options: ClientOptions): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    const list = await new OpenAI(options).models.list();
    const models: Array<{ id: string }> = [];
    for await (const model of list) {
      models.push(model);
    }
    return models
      .filter((m) => m.id.startsWith("grok-") && !m.id.includes("-image"))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, description: "", openaiEffort: Nothing<OpenAIModelEffort>() }));
  }).mapRej((error) => new Error(`Failed to fetch xAI models: ${error instanceof Error ? error.message : String(error)}`));

const fetchXaiModels = (authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> => {
  switch (authMethod.type) {
    case "api_key":
      return fetchXaiModelsWith(xaiApiKeyOptions(authMethod.content));
    case "xai_oauth":
      return fetchXaiModelsWith(xaiOAuthOptions(authMethod.content.access_token));
    case "google_oauth":
    case "openai_oauth":
    case "anthropic_setup_token":
      return unsupportedAuth("xai", authMethod.type);
    default:
      return absurd(authMethod, "AuthMethod");
  }
};

const fetchModels = (provider: ProviderConfig["provider"], authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> => {
  switch (provider) {
    case "openai":
      return fetchOpenAIModels(authMethod);
    case "gemini":
      return fetchGeminiModels(authMethod);
    case "anthropic":
      return fetchAnthropicModels(authMethod);
    case "xai":
      return fetchXaiModels(authMethod);
  }
};
