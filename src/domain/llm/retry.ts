export { withTransientRetry, isTransientLlmError };

import * as p from "@clack/prompts";
import color from "picocolors";
import { Future } from "@/libs/future";

const MAX_AUTO_ATTEMPTS = 3;

const TRANSIENT_PATTERNS = [
  /terminated/i,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /socket hang up/i,
  /\b(502|503|504|529)\b/,
  /overloaded/i,
  /rate.?limit/i
];

const isTransientLlmError = (err: Error): boolean => {
  const causeMessage = err.cause instanceof Error ? err.cause.message : "";
  const msg = `${err.message} ${causeMessage}`;
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
};

const backoffMs = (attempt: number): number => Math.min(8_000, 500 * 2 ** attempt);

const promptRetry = (err: Error): Future<Error, boolean> =>
  Future.attemptP(async () => {
    p.log.warn(color.yellow(`Transient LLM error after ${MAX_AUTO_ATTEMPTS} retries: ${err.message}`));
    const ok = await p.confirm({ message: "Retry?" });
    return !(p.isCancel(ok) || !ok);
  });

const withTransientRetry = <T>(make: () => Future<Error, T>): Future<Error, T> => {
  const attemptN = (n: number): Future<Error, T> =>
    make().chainRej((err): Future<Error, T> => {
      if (!isTransientLlmError(err)) return Future.reject(err);
      if (n + 1 < MAX_AUTO_ATTEMPTS) {
        return Future.resolveAfter<Error, void>(backoffMs(n), undefined).chain(() => attemptN(n + 1));
      }
      return promptRetry(err).chain((retry) => (retry ? attemptN(0) : Future.reject(err)));
    });

  return attemptN(0);
};
