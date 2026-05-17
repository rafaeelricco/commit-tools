export { loading, bracketStatus, type StatusMessageSink, type BracketStatus };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";

type StatusMessageSink = {
  readonly message: (msg: string) => void;
};

type BracketStatus = <T>(startLabel: string, stopLabel: string, body: (status: StatusMessageSink) => Future<Error, T>) => Future<Error, T>;

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

const bracketStatus: BracketStatus = <T>(
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
