export { type RawResponse, extractResponse };

import { Maybe, Just, Nothing } from "@/libs/maybe";
import { Future } from "@/libs/future";

type RawResponse = { text: Maybe<string> };

const extractResponse = (raw: RawResponse): Future<Error, string> =>
  raw.text
    .map((s) => s.trim())
    .chain((s) => (s.length === 0 ? Nothing<string>() : Just(s)))
    .unwrap(
      () => Future.reject<Error, string>(new Error("Response text is empty or missing")),
      (s) => Future.resolve<Error, string>(s)
    );
