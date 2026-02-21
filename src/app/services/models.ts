export { fetchModels, selectModelInteractively, type Model };

import { Future } from "@/libs/future";
import { type ProviderConfig, type OAuthTokens } from "@/app/services/config";

type Model = {
  readonly id: string;
  readonly description: string;
};

const fetchModels = (authMethod: ProviderConfig["auth_method"]): Future<Error, Model[]> =>
  Future.attemptP(async () => {
    let url = "https://generativelanguage.googleapis.com/v1beta/models";
    let headers: Record<string, string> = {};

    if (authMethod.type === "api_key") {
      url += `?key=${authMethod.content}`;
    } else {
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
