export { openaiReasoningParam, geminiLevelConfig, geminiBudgetConfig, seedProviderConfig, withModel, selectEffortForProvider };

import { type ThinkingConfig, ThinkingLevel } from "@google/genai";
import { type Future } from "@/libs/future";
import { Nothing, type Maybe } from "@/libs/maybe";
import { type ProviderConfig, type OpenAIEffort, type AnthropicEffort, type GeminiEffort } from "@/domain/config/config";
import { selectOpenAIEffort, selectAnthropicEffort, selectGeminiEffort } from "@/infra/ui/effort-picker";
import { absurd } from "@/libs/types";

import type OpenAI from "openai";

const openaiReasoningParam = (effort: Maybe<OpenAIEffort>): { reasoning: OpenAI.Reasoning } | undefined =>
  effort.maybe<{ reasoning: OpenAI.Reasoning } | undefined>(undefined, (e) => ({
    reasoning: { effort: e }
  }));

const LEVEL_MAP: Record<GeminiEffort, ThinkingLevel> = {
  MINIMAL: ThinkingLevel.MINIMAL,
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  HIGH: ThinkingLevel.HIGH
};

const geminiLevelConfig = (effort: Maybe<GeminiEffort>): { thinkingConfig: ThinkingConfig } | undefined =>
  effort.maybe<{ thinkingConfig: ThinkingConfig } | undefined>(undefined, (e) => ({
    thinkingConfig: { thinkingLevel: LEVEL_MAP[e] }
  }));

const BUDGET_BY_LEVEL: Record<GeminiEffort, number> = {
  MINIMAL: 128,
  LOW: 512,
  MEDIUM: 2048,
  HIGH: 8192
};

const geminiBudgetConfig = (effort: Maybe<GeminiEffort>): { thinkingConfig: ThinkingConfig } | undefined =>
  effort.maybe<{ thinkingConfig: ThinkingConfig } | undefined>(undefined, (e) => ({
    thinkingConfig: { thinkingBudget: BUDGET_BY_LEVEL[e] }
  }));

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
