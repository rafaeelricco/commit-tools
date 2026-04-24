export {
  type CommitConvention,
  type OAuthTokens,
  type OpenAITokens,
  type RefreshTokens,
  type AuthMethod,
  type ProviderConfig,
  type OpenAIEffort,
  type AnthropicEffort,
  type GeminiEffort,
  type Model,
  Config,
  schema_OAuthTokens,
  schema_OpenAITokens,
  schema_AuthMethod,
  schema_ProviderConfig,
  AI_PROVIDERS,
  COMMIT_CONVENTIONS,
  OPENAI_EFFORTS,
  ANTHROPIC_EFFORTS,
  GEMINI_EFFORTS
};

import * as s from "@/libs/json/schema";

import { ThinkingLevel } from "@google/genai";

import type OpenAIPkg from "openai";
import type AnthropicPkg from "@anthropic-ai/sdk";

const COMMIT_CONVENTIONS = ["conventional", "imperative", "custom"] as const;
type CommitConvention = (typeof COMMIT_CONVENTIONS)[number];

const AI_PROVIDERS = ["gemini", "openai", "anthropic"] as const;

const schema_OAuthTokens = s.object({
  access_token: s.string,
  refresh_token: s.string,
  expiry_date: s.number,
  token_type: s.string,
  scope: s.string
});
type OAuthTokens = s.Infer<typeof schema_OAuthTokens>;

const schema_OpenAITokens = s.object({
  access_token: s.string,
  refresh_token: s.string,
  expiry_date: s.number
});
type OpenAITokens = s.Infer<typeof schema_OpenAITokens>;

type RefreshTokens = OAuthTokens | OpenAITokens;

const schema_AuthMethod = s.discriminatedUnion([
  s.variant({
    type: "api_key",
    content: s.string
  }),
  s.variant({
    type: "google_oauth",
    content: schema_OAuthTokens
  }),
  s.variant({
    type: "openai_oauth",
    content: schema_OpenAITokens
  }),
  s.variant({
    type: "anthropic_setup_token",
    content: s.string
  })
]);
type AuthMethod = s.Infer<typeof schema_AuthMethod>["type"];

const OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const satisfies readonly NonNullable<OpenAIPkg.Reasoning["effort"]>[];
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly NonNullable<AnthropicPkg.OutputConfig["effort"]>[];
const GEMINI_EFFORTS = [ThinkingLevel.MINIMAL, ThinkingLevel.LOW, ThinkingLevel.MEDIUM, ThinkingLevel.HIGH] as const satisfies readonly ThinkingLevel[];

type OpenAIEffort = (typeof OPENAI_EFFORTS)[number];
type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];
type GeminiEffort = (typeof GEMINI_EFFORTS)[number];

const schema_ProviderConfig = s.discriminatedUnion([
  s.variant({
    provider: "gemini",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...GEMINI_EFFORTS]))
  }),
  s.variant({
    provider: "openai",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...OPENAI_EFFORTS]))
  }),
  s.variant({
    provider: "anthropic",
    model: s.string,
    auth_method: schema_AuthMethod,
    effort: s.optionalMaybe(s.stringEnum([...ANTHROPIC_EFFORTS]))
  })
]);
type ProviderConfig = s.Infer<typeof schema_ProviderConfig>;

const Config = s.object({
  ai: schema_ProviderConfig,
  commit_convention: s.stringEnum([...COMMIT_CONVENTIONS]),
  custom_template: s.optionalMaybe(s.string)
});
type Config = s.Infer<typeof Config>;

const Model = s.object({
  id: s.string,
  description: s.string
});
type Model = s.Infer<typeof Model>;
