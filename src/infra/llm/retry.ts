export { isTransientLLMError, withTransientRetry };

import { Future } from "@/libs/future";

const TRANSIENT_MESSAGE_FRAGMENTS = [
  "terminated",
  "socket hang up",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "network error",
  "fetch failed"
];

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

const messageMatchesTransient = (message: string): boolean => {
  const lower = message.toLowerCase();
  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => lower.includes(fragment.toLowerCase()));
};

type ErrorLike = { name?: unknown; message?: unknown; status?: unknown; cause?: unknown };

const isTransientByName = (e: ErrorLike): boolean =>
  typeof e.name === "string" && (e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError");

const isTransientByStatus = (e: ErrorLike): boolean => typeof e.status === "number" && TRANSIENT_HTTP_STATUSES.has(e.status);

const isTransientByMessage = (e: ErrorLike): boolean => typeof e.message === "string" && messageMatchesTransient(e.message);

const isTransientObject = (e: ErrorLike): boolean =>
  isTransientByName(e) || isTransientByStatus(e) || isTransientByMessage(e) || (e.cause !== undefined && isTransientLLMError(e.cause));

const isTransientLLMError = (err: unknown): boolean => {
  if (err === null || err === undefined) return false;
  if (typeof err === "string") return messageMatchesTransient(err);
  if (typeof err === "object") return isTransientObject(err as ErrorLike);
  return false;
};

type RetryOpts = {
  retries?: number;
  baseMs?: number;
  capMs?: number;
  label?: string;
};

const withTransientRetry = <A>(make: () => Future<Error, A>, opts: RetryOpts = {}): Future<Error, A> => {
  const retries = opts.retries ?? 2;
  const baseMs = opts.baseMs ?? 500;
  const capMs = opts.capMs ?? 1500;
  const label = opts.label ?? "llm";

  const attempt = (n: number): Future<Error, A> =>
    make().chainRej((err) => {
      if (n >= retries || !isTransientLLMError(err)) return Future.reject(err);
      const exp = Math.min(capMs, baseMs * 2 ** n);
      const jitter = Math.random() * (baseMs / 2);
      const delay = exp + jitter;
      process.stderr.write(`[${label}] transient error, retrying (${n + 1}/${retries})…\n`);
      return Future.resolveAfter<Error, void>(delay, undefined).chain(() => attempt(n + 1));
    });

  return attempt(0);
};
