export { type OAuthCredentials, type Dependencies, configureDependencies };

import { Future } from "@/libs/future";

type OAuthCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

type Dependencies = {
  readonly resolveOAuth: () => Future<Error, OAuthCredentials>;
};

function configureDependencies(): Dependencies {
  return {
    resolveOAuth: () => {
      const clientId = process.env["GOOGLE_CLIENT_ID"];
      const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];

      if (!clientId || !clientSecret) {
        return Future.reject(
          new Error(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for OAuth authentication.\n" +
              "Set them in your environment or use 'commit-tools setup' with the API Key method instead."
          )
        );
      }

      return Future.resolve({ clientId, clientSecret });
    }
  };
}
