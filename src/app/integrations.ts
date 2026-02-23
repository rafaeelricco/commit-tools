// Environment variables
// All environment variables used by the entire program are here.
//
// This module ensures all environment variables are:
//
// - Type-checked
// - Decoded at the beginning of the program
// - Handled consistently
// - Visible in a single place

export { type Environment, environment };

import * as D from "@/libs/json/decoder";

type Environment = D.Infer<typeof envDecoder>;

const envDecoder = D.object({
  GOOGLE_CLIENT_ID: D.string,
  GOOGLE_CLIENT_SECRET: D.string
});

const environment: Environment = D.decode(process.env, envDecoder).either(
  (err) => {
    throw new Error(`Unable to parse environment variables:\n${err}`);
  },
  (env) => env
);
