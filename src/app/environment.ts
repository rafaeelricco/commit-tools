// Environment variables
// All environment variables used by the entire program are here.
//
// This module ensures all environment variables are:
//
// - Type-checked
// - Decoded at the beginning of the program.
// - Handled consistently
// - Visible in a single place.

import * as D from "@/libs/json/decoder";

type Environment = D.Infer<typeof envDecoder>;

const string = D.string;

// All expected environment variables are checked at program initialization.
const envDecoder = D.object({
  // Google OAuth
  GOOGLE_CLIENT_ID: string,
  GOOGLE_CLIENT_SECRET: string,
});

const environment: Environment = D.decode(process.env, envDecoder).unwrap(err => {
  throw new Error(`Unable to parse environment variables:\n${err}`);
});

export default environment;
