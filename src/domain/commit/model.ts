export { fetchModels, selectModelInteractively };

import { Future } from "@/libs/future";
import { Model, type ProviderConfig } from "@/domain/config/config";
import { getOpenAIAccessToken } from "@/lib/auth/openai";
import { anthropicOAuthHeaders } from "@/lib/auth/anthropic";

import OpenAI from "openai";

type CodexModel = {
  readonly slug: string;
  readonly display_name: string;
  readonly description: string;
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
      .map((m) => ({ id: m.id, description: "" }));
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
        .map((m) => ({ id: m.slug, description: m.description }));
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
      description: m.description || ""
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
      .map((m) => ({ id: m.id, description: m.display_name ?? "" }));
  });

const fetchModels = (
  provider: ProviderConfig["provider"],
  authMethod: ProviderConfig["auth_method"]
): Future<Error, Model[]> => {
  switch (provider) {
    case "openai":
      return fetchOpenAIModels(authMethod);
    case "gemini":
      return fetchGeminiModels(authMethod);
    case "anthropic":
      return fetchAnthropicModels(authMethod);
  }
};

const selectModelInteractively = (models: Model[]): Future<Error, string> =>
  Future.attemptP(async () => {
    const { render } = await import("ink");
    const React = await import("react");
    const { ModelSelector } = await import("@/lib/ui/components/model-selector");

    return new Promise<string>((resolve, reject) => {
      const { unmount } = render(
        React.createElement(ModelSelector, {
          models,
          onSelect: (modelId: string) => {
            unmount();
            resolve(modelId);
          },
          onCancel: () => {
            unmount();
            reject(new Error("Selection cancelled"));
          }
        })
      );
    });
  });
