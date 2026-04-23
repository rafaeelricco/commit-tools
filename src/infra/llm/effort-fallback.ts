// TODO: I don't know what of these is the worst. We need to review all of this and probably change the function signatures to something more simple, instead of doing this complex thing with "Maybe" and "Future" and "EffortAttempt" and all that. We just need a simple function that takes a list of attempts and tries them one by one until it succeeds or runs out of attempts. That's it. No need for all this complexity.
export { tryWithEffort, type EffortAttempt };

import { Future } from "@/libs/future";

type EffortAttempt<T> = () => Future<Error, T>;

const EFFORT_FIELD_RE =
  /reasoning|thinking|thinking_config|output_config|budget_tokens|thinkingconfig|thinkinglevel|thinkingbudget/i;
const BAD_REQUEST_RE = /(\b400\b|invalid_request|unsupported_parameter|bad_request|invalid_parameter)/i;

const isEffortRejection = (err: Error): boolean => {
  const msg = err.message;
  return EFFORT_FIELD_RE.test(msg) && BAD_REQUEST_RE.test(msg);
};

const tryWithEffort = <T>(attempts: readonly [EffortAttempt<T>, ...EffortAttempt<T>[]]): Future<Error, T> => {
  const walk = (fn: EffortAttempt<T>, remaining: readonly EffortAttempt<T>[]): Future<Error, T> =>
    fn().chainRej((err) => {
      const next = remaining[0];
      if (next === undefined || !isEffortRejection(err)) return Future.reject(err);
      return walk(next, remaining.slice(1));
    });

  return walk(attempts[0], attempts.slice(1));
};
