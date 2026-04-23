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

// TODO: omg, what is that?
// Effort value arrays — the one runtime listing the UI and schema need.
//
// Provider notes on "why the hand-written list":
// - OpenAI's `ReasoningEffort` and Anthropic's `OutputConfig.effort` are both
//   TypeScript string-union types. TS types don't exist at runtime, so we
//   CAN'T iterate them — the values must be enumerated. Safety comes from
//   two complementary compile-time checks:
//     1. `satisfies readonly NonNullable<SDK>[]`  → each element is valid.
//     2. `assertExhaustive<...>()`                → SDK has no extra value.
//   If a pinned SDK adds or removes a value, the build breaks immediately.
// - Gemini's `ThinkingLevel` IS a real (runtime) enum, so we derive the
//   array directly via `Object.values`. No hand-written list at all.
const OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const satisfies readonly NonNullable<
  OpenAIPkg.Reasoning["effort"]
>[];
const ANTHROPIC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly NonNullable<
  AnthropicPkg.OutputConfig["effort"]
>[];

const isNamedThinkingLevel = (
  v: ThinkingLevel
): v is Exclude<ThinkingLevel, typeof ThinkingLevel.THINKING_LEVEL_UNSPECIFIED> =>
  v !== ThinkingLevel.THINKING_LEVEL_UNSPECIFIED;

const GEMINI_EFFORTS = Object.values(ThinkingLevel).filter(isNamedThinkingLevel);

type OpenAIEffort = (typeof OPENAI_EFFORTS)[number];
type AnthropicEffort = (typeof ANTHROPIC_EFFORTS)[number];
type GeminiEffort = (typeof GEMINI_EFFORTS)[number];

// Reverse-direction guard: every SDK-declared value must appear in our array.
// `satisfies` catches "array has invalid value"; this catches "SDK added a
// value we haven't listed yet". Together they lock the two sides together.
type AssertEmpty<T> = [T] extends [never] ? true : ["Missing SDK effort values", T];
const _openaiCoversSdk: AssertEmpty<Exclude<NonNullable<OpenAIPkg.Reasoning["effort"]>, OpenAIEffort>> = true;
const _anthropicCoversSdk: AssertEmpty<Exclude<NonNullable<AnthropicPkg.OutputConfig["effort"]>, AnthropicEffort>> =
  true;
void _openaiCoversSdk;
void _anthropicCoversSdk;

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
