// Environment variables
// All environment variables used by the entire program are here.
//
// This module ensures all environment variables are:
//
// - Type-checked
// - Decoded at the beginning of the program.
// - Handled consistently
// - Visible in a single place.

import * as D from "@/json/decoder";

type Environment = D.Infer<typeof envDecoder>;

const envDecoder = D.object({
  // Add environment variables as the project grows.
});

const environment: Environment = D.decode(process.env, envDecoder).unwrap(err => {
  throw new Error(`Unable to parse environment variables:\n${err}`);
});

export default environment;
