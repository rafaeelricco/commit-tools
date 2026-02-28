export { fetchModels, selectModelInteractively, type Model };

import { Future } from "@/libs/future";
import { type ProviderConfig, type OAuthTokens } from "@/app/services/config";

import OpenAI from "openai";

type Model = {
  readonly id: string;
  readonly description: string;
};

const fetchOpenAIModels = (): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    const client = new OpenAI();
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

const fetchModels = (
  provider: ProviderConfig["provider"],
  authMethod: ProviderConfig["auth_method"]
): Future<Error, Model[]> => {
  if (provider === "openai") {
    return fetchOpenAIModels();
  }

  return Future.attemptP(async () => {
    let url = "https://generativelanguage.googleapis.com/v1beta/models";
    let headers: Record<string, string> = {};

    if (authMethod.type === "api_key") {
      url += `?key=${authMethod.content}`;
    } else if (authMethod.type === "google_oauth") {
      const tokens = authMethod.content as OAuthTokens;
      headers["Authorization"] = `Bearer ${tokens.access_token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = (await response.json()) as { models?: any[] };
    return (data.models || []).map((m: any) => ({
      id: m.name.replace("models/", ""),
      description: m.description || ""
    }));
  });
};

const selectModelInteractively = (models: Model[]): Future<Error, string> =>
  Future.attemptP(async () => {
    const { render } = await import("ink");
    const React = await import("react");
    const { ModelSelector } = await import("@/app/components/model-selector");

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
