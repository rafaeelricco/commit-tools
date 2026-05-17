import * as p from "@clack/prompts";

import { Future } from "@/libs/future";

/** Sink for user-visible status text while a bracketed `Future` runs. */
export type StatusMessageSink = {
  readonly message: (msg: string) => void;
};

/** Brackets a `Future` with a live status sink and clack spinner teardown. */
export type BracketStatus = <T>(startLabel: string, stopLabel: string, body: (status: StatusMessageSink) => Future<Error, T>) => Future<Error, T>;

const loading = <T>(label: string, stopLabel: string, f: Future<Error, T>): Future<Error, T> => {
  const s = p.spinner();
  s.start(label);
  return f
    .map((v) => {
      s.stop(stopLabel);
      return v;
    })
    .mapRej((e) => {
      s.stop("Failed.");
      return e;
    });
};

/**
 * Brackets async work: starts a clack spinner with `startLabel`, passes a `status`
 * sink for `message` updates, then stops with `stopLabel` on success or `"Failed."` on rejection.
 */
export const bracketStatus: BracketStatus = <T>(
  startLabel: string,
  stopLabel: string,
  body: (status: StatusMessageSink) => Future<Error, T>
): Future<Error, T> => {
  const s = p.spinner();
  s.start(startLabel);
  const status: StatusMessageSink = { message: (msg) => s.message(msg) };
  return body(status)
    .map((v) => {
      s.stop(stopLabel);
      return v;
    })
    .mapRej((e) => {
      s.stop("Failed.");
      return e;
    });
};

export { loading };
