export {
  type CommitConvention,
  type OAuthTokens,
  type AuthMethod,
  Config,
  schema_OAuthTokens,
  schema_AuthMethod,
  COMMIT_CONVENTIONS
};

import * as s from "@/libs/json/schema";

const COMMIT_CONVENTIONS = ["conventional", "imperative", "custom"] as const;
type CommitConvention = (typeof COMMIT_CONVENTIONS)[number];

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
type schema_AuthMethodType = s.Infer<typeof schema_AuthMethod>;

type AuthMethod = schema_AuthMethodType["type"];

const Config = s.object({
  auth_method: schema_AuthMethod,
  commit_convention: s.stringEnum([...COMMIT_CONVENTIONS]),
  custom_template: s.optionalMaybe(s.string)
});
type Config = s.Infer<typeof Config>;
