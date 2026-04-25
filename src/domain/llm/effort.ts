export { seedProviderConfig, withModel, selectEffortForProvider };

import { type Future } from "@/libs/future";
import { type ProviderConfig, type OpenAIEffort, type AnthropicEffort, type GeminiEffort } from "@/domain/config/config";
import { Nothing } from "@/libs/maybe";
import { selectOpenAIEffort, selectAnthropicEffort, selectGeminiEffort } from "@/infra/ui/effort-picker";
import { absurd } from "@/libs/types";

const seedProviderConfig = (provider: ProviderConfig["provider"], model: string, auth_method: ProviderConfig["auth_method"]): ProviderConfig => {
  switch (provider) {
    case "openai":
      return { provider, model, auth_method, effort: Nothing<OpenAIEffort>() };
    case "anthropic":
      return { provider, model, auth_method, effort: Nothing<AnthropicEffort>() };
    case "gemini":
      return { provider, model, auth_method, effort: Nothing<GeminiEffort>() };
    default:
      return absurd(provider, "provider");
  }
};

const withModel = (ai: ProviderConfig, model: string): ProviderConfig => {
  switch (ai.provider) {
    case "openai":
      return { provider: "openai", model, auth_method: ai.auth_method, effort: ai.effort };
    case "anthropic":
      return { provider: "anthropic", model, auth_method: ai.auth_method, effort: ai.effort };
    case "gemini":
      return { provider: "gemini", model, auth_method: ai.auth_method, effort: ai.effort };
    default:
      return absurd(ai, "ProviderConfig");
  }
};

const selectEffortForProvider = (current: ProviderConfig): Future<Error, ProviderConfig> => {
  switch (current.provider) {
    case "openai":
      return selectOpenAIEffort(current.model, current.effort).map(
        (effort): ProviderConfig => ({
          provider: "openai",
          model: current.model,
          auth_method: current.auth_method,
          effort
        })
      );
    case "anthropic":
      return selectAnthropicEffort(current.model, current.effort).map(
        (effort): ProviderConfig => ({
          provider: "anthropic",
          model: current.model,
          auth_method: current.auth_method,
          effort
        })
      );
    case "gemini":
      return selectGeminiEffort(current.model, current.effort).map(
        (effort): ProviderConfig => ({
          provider: "gemini",
          model: current.model,
          auth_method: current.auth_method,
          effort
        })
      );
    default:
      return absurd(current, "ProviderConfig");
  }
};
