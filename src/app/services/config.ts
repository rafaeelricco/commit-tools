export {
  type CommitConvention,
  type OAuthTokens,
  type AuthMethod,
  type ProviderConfig,
  Config,
  schema_OAuthTokens,
  schema_AuthMethod,
  schema_ProviderConfig,
  COMMIT_CONVENTIONS,
  AI_PROVIDERS,
  DEFAULT_MODELS
};

import * as s from "@/libs/json/schema";

const COMMIT_CONVENTIONS = ["conventional", "imperative", "custom"] as const;
type CommitConvention = (typeof COMMIT_CONVENTIONS)[number];

const AI_PROVIDERS = ["gemini"] as const;
type AIProvider = (typeof AI_PROVIDERS)[number];

const DEFAULT_MODELS = {
  gemini: "gemini-flash-lite-latest"
} as const satisfies Record<AIProvider, string>;

const schema_OAuthTokens = s.object({
  access_token: s.string,
  refresh_token: s.string,
  expiry_date: s.number,
  token_type: s.string,
  scope: s.string
});
type OAuthTokens = s.Infer<typeof schema_OAuthTokens>;

const schema_AuthMethod = s.discriminatedUnion([
  s.variant({
    type: "api_key",
    content: s.string
  }),
  s.variant({
    type: "oauth",
    content: schema_OAuthTokens
  })
]);
type AuthMethod = s.Infer<typeof schema_AuthMethod>["type"];

const schema_ProviderConfig = s.discriminatedUnion([
  s.variant({
    provider: "gemini",
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
