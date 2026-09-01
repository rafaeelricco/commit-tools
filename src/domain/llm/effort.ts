export { seedProviderConfig, withModel, withMinEffort, withDefaultMinEffort, selectEffortForProvider };

import { type Future } from "@/libs/future";
import {
  type ProviderConfig,
  type OpenAIEffort,
  type OpenAIModelEffort,
  type XaiEffort,
  type AnthropicEffort,
  type GeminiEffort,
  GEMINI_EFFORTS
} from "@/domain/config/config";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { selectOpenAIEffort, selectAnthropicEffort, selectGeminiEffort, selectXaiEffort } from "@/infra/ui/effort-picker";
import { absurd } from "@/libs/types";

const seedProviderConfig = (provider: ProviderConfig["provider"], model: string, auth_method: ProviderConfig["auth_method"]): ProviderConfig => {
  switch (provider) {
    case "openai":
      return { provider, model, auth_method, effort: Nothing<OpenAIEffort>() };
    case "anthropic":
      return { provider, model, auth_method, effort: Nothing<AnthropicEffort>() };
    case "gemini":
      return { provider, model, auth_method, effort: Nothing<GeminiEffort>() };
    case "xai":
      return { provider, model, auth_method, effort: Nothing<XaiEffort>() };
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
    case "xai":
      return { provider: "xai", model, auth_method: ai.auth_method, effort: ai.effort };
    default:
      return absurd(ai, "ProviderConfig");
  }
};

const withMinEffort = (config: ProviderConfig): ProviderConfig => {
  switch (config.provider) {
    case "openai":
      return { provider: "openai", model: config.model, auth_method: config.auth_method, effort: Just("low") };
    case "anthropic":
      return { provider: "anthropic", model: config.model, auth_method: config.auth_method, effort: Just("low") };
    case "gemini":
      return { provider: "gemini", model: config.model, auth_method: config.auth_method, effort: Just(GEMINI_EFFORTS[0]) };
    case "xai":
      return { provider: "xai", model: config.model, auth_method: config.auth_method, effort: Just("low") };
    default:
      return absurd(config, "ProviderConfig");
  }
};

const withDefaultMinEffort = (config: ProviderConfig): ProviderConfig => (config.effort instanceof Nothing ? withMinEffort(config) : config);

const selectEffortForProvider = (current: ProviderConfig, modelEffort: Maybe<OpenAIModelEffort> = Nothing()): Future<Error, ProviderConfig> => {
  switch (current.provider) {
    case "openai":
      return selectOpenAIEffort(current.model, current.effort, modelEffort).map(
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
    case "xai":
      return selectXaiEffort(current.model, current.effort).map(
        (effort): ProviderConfig => ({
          provider: "xai",
          model: current.model,
          auth_method: current.auth_method,
          effort
        })
      );
    default:
      return absurd(current, "ProviderConfig");
  }
};
