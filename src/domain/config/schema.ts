import * as s from "@/json/schema";

export const CommitConvention = s.stringEnum(["conventional", "imperative", "custom"]);
export type CommitConvention = s.Infer<typeof CommitConvention>;

export const AuthMethod = s.stringEnum(["api_key", "oauth"]);
export type AuthMethod = s.Infer<typeof AuthMethod>;

export const OAuthTokens = s.object({
  access_token: s.string,
  refresh_token: s.string,
  expiry_date: s.number,
  token_type: s.string,
  scope: s.string,
});
export type OAuthTokens = s.Infer<typeof OAuthTokens>;

export const Config = s.object({
  auth_method: s.optionalDefault("api_key" as AuthMethod, AuthMethod),
  api_key: s.optional(s.string),
  tokens: s.optional(OAuthTokens),
  commit_convention: CommitConvention,
  custom_template: s.optional(s.string),
});
export type Config = s.Infer<typeof Config>;
