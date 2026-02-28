export {
  type CommitConvention,
  type OAuthTokens,
  type OpenAITokens,
  type RefreshTokens,
  type AuthMethod,
  type ProviderConfig,
  Config,
  schema_OAuthTokens,
  schema_OpenAITokens,
  schema_AuthMethod,
  schema_ProviderConfig,
  COMMIT_CONVENTIONS,
  AI_PROVIDERS
};

import * as s from "@/libs/json/schema";

const COMMIT_CONVENTIONS = ["conventional", "imperative", "custom"] as const;
type CommitConvention = (typeof COMMIT_CONVENTIONS)[number];

const AI_PROVIDERS = ["gemini", "openai"] as const;

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
  })
]);
type AuthMethod = s.Infer<typeof schema_AuthMethod>["type"];

const schema_ProviderConfig = s.discriminatedUnion([
  s.variant({
    provider: "gemini",
    model: s.string,
    auth_method: schema_AuthMethod
  }),
  s.variant({
    provider: "openai",
    model: s.string,
    auth_method: schema_AuthMethod
  })
]);
type ProviderConfig = s.Infer<typeof schema_ProviderConfig>;

const Config = s.object({
  ai: schema_ProviderConfig,
  commit_convention: s.stringEnum([...COMMIT_CONVENTIONS]),
  custom_template: s.optionalMaybe(s.string)
});
type Config = s.Infer<typeof Config>;
