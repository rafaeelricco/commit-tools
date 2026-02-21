export { loading, showHelp, showVersion };

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

const showHelp = (): void => {
  console.log(`
Usage: commit-tools [command]

Commands:
  generate (default)  Generate a commit message
  setup               Configure authentication and conventions
  login               Alias for setup (re-authenticate)
  doctor              Check installation and environment
  --version, -v       Show version
  --help, -h          Show help
  `);
};

const showVersion = (): void => {
  const start = performance.now();
  console.log("commit-tools 0.1.0 (bun)");
  const elapsed = performance.now() - start;
  console.log(`Done in ${elapsed.toLocaleString()}ms`);
};
