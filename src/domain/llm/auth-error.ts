export { unsupportedAuth };

import { Future } from "@/libs/future";
import { type AuthMethod, type ProviderConfig } from "@/domain/config/config";

const unsupportedAuth = (provider: ProviderConfig["provider"], authType: AuthMethod): Future<Error, never> =>
  Future.reject(new Error(`Unsupported auth method for ${provider}: ${authType}`));
