export { resolveProvider };

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { type Config, type ProviderConfig, type RefreshTokens } from "@/app/services/config";
import { ensureFreshTokens } from "@/app/services/googleAuth";
import { ensureFreshOpenAITokens } from "@/app/services/openaiAuth";
import { updateGoogleTokens, updateOpenAITokens } from "@/app/storage";

type DetectTokenChange = <T extends RefreshTokens>(original: T, fresh: T) => Maybe<T>;
type RefreshProvider<T extends RefreshTokens> = (tokens: T) => Future<Error, T>;
type PersistProvider<T extends RefreshTokens> = (tokens: T) => Future<Error, void>;

type RefreshAndPersistFlow = <T extends RefreshTokens>(
  tokens: T,
  refresh: RefreshProvider<T>,
  persist: PersistProvider<T>
) => Future<Error, T>;

type ResolveProvider = (config: Config) => Future<Error, ProviderConfig>;

const tokensChanged: DetectTokenChange = (original, fresh) =>
  fresh.access_token !== original.access_token || fresh.expiry_date !== original.expiry_date ? Just(fresh) : Nothing();

const refreshAndPersist: RefreshAndPersistFlow = (tokens, refresh, persist) =>
  refresh(tokens).chain((fresh) =>
    tokensChanged(tokens, fresh).maybe(Future.resolve(fresh), (changed) => persist(changed).map(() => fresh))
  );

const resolveProvider: ResolveProvider = (config) => {
  const { ai } = config;
  const { auth_method } = ai;

  switch (auth_method.type) {
    case "api_key":
      return Future.resolve(ai);

    case "google_oauth":
      return refreshAndPersist(auth_method.content, ensureFreshTokens, updateGoogleTokens).map((tokens) => ({
        provider: ai.provider,
        model: ai.model,
        auth_method: { type: "google_oauth", content: tokens }
      }));

    case "openai_oauth":
      return refreshAndPersist(auth_method.content, ensureFreshOpenAITokens, updateOpenAITokens).map((tokens) => ({
        provider: ai.provider,
        model: ai.model,
        auth_method: { type: "openai_oauth", content: tokens }
      }));

    default: {
      const _exhaustiveCheck: never = auth_method;
      return Future.reject(new Error(`Unknown auth method: ${JSON.stringify(_exhaustiveCheck)}`));
    }
  }
};
