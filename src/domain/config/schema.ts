import * as s from "@/json/schema";

export const CommitConvention = s.stringEnum(["conventional", "imperative", "custom"]);
export type CommitConvention = s.Infer<typeof CommitConvention>;

export const Config = s.object({
  api_key: s.string,
  commit_convention: CommitConvention,
  custom_template: s.optional(s.string),
});
export type Config = s.Infer<typeof Config>;
