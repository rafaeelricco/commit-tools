export { environment };

import * as D from "@/libs/json/decoder";

type Environment = D.Infer<typeof envDecoder>;

const string = D.string;

const envDecoder = D.object({
  // Google OAuth
  GOOGLE_CLIENT_ID: string,
  GOOGLE_CLIENT_SECRET: string,
});

const environment: Environment = D.decode(process.env, envDecoder).unwrap(err => {
  throw new Error(`Unable to parse environment variables:\n${err}`);
});
