export { loading };

import * as p from "@clack/prompts";

import { Future } from "@/libs/future";

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
