export { resolveProvider };

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Config, type ProviderConfig, type RefreshTokens } from "@/domain/config/config";
import { ensureFreshTokens } from "@/infra/auth/google";
import { ensureFreshOpenAITokens } from "@/infra/auth/openai";
import { updateGoogleTokens, updateOpenAITokens } from "@/infra/storage/config";
import { absurd } from "@/libs/types";

type DetectTokenChange = <T extends RefreshTokens>(original: T, fresh: T) => Maybe<T>;
type RefreshProvider<T extends RefreshTokens> = (tokens: T) => Future<Error, T>;
type PersistProvider<T extends RefreshTokens> = (tokens: T) => Future<Error, void>;

type RefreshAndPersistFlow = <T extends RefreshTokens>(tokens: T, refresh: RefreshProvider<T>, persist: PersistProvider<T>) => Future<Error, T>;
type ResolveProvider = (config: Config) => Future<Error, ProviderConfig>;

const tokensChanged: DetectTokenChange = (original, fresh) =>
  fresh.access_token !== original.access_token || fresh.expiry_date !== original.expiry_date ? Just(fresh) : Nothing();

const refreshAndPersist: RefreshAndPersistFlow = (tokens, refresh, persist) =>
  refresh(tokens).chain((fresh) =>
    tokensChanged(tokens, fresh).unwrap(
      () => Future.resolve(fresh),
      (changed) => persist(changed).map(() => fresh)
    )
  );

const resolveAuthMethod = (ai: ProviderConfig, auth_method: ProviderConfig["auth_method"]): ProviderConfig => {
  switch (ai.provider) {
    case "openai":
      return { provider: "openai", model: ai.model, auth_method, effort: ai.effort };
    case "anthropic":
      return { provider: "anthropic", model: ai.model, auth_method, effort: ai.effort };
    case "gemini":
      return { provider: "gemini", model: ai.model, auth_method, effort: ai.effort };
    default:
      return absurd(ai, "ProviderConfig");
  }
};

const resolveProvider: ResolveProvider = (config) => {
  const { ai } = config;

  switch (ai.auth_method.type) {
    case "api_key":
    case "anthropic_setup_token":
      return Future.resolve(ai);

    case "google_oauth":
      return refreshAndPersist(ai.auth_method.content, ensureFreshTokens, updateGoogleTokens).map((tokens) =>
        resolveAuthMethod(ai, { type: "google_oauth", content: tokens })
      );

    case "openai_oauth":
      return refreshAndPersist(ai.auth_method.content, ensureFreshOpenAITokens, updateOpenAITokens).map((tokens) =>
        resolveAuthMethod(ai, { type: "openai_oauth", content: tokens })
      );

    default:
      return absurd(ai.auth_method, "AuthMethod");
  }
};
