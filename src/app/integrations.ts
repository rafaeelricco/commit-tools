export { type Dependencies, configureDependencies };

import environment from "@/app/environment";

type Dependencies = {
  readonly oauth: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
};

function configureDependencies(): Dependencies {
  return {
    oauth: {
      clientId: environment.GOOGLE_CLIENT_ID,
      clientSecret: environment.GOOGLE_CLIENT_SECRET,
    },
  };
}
