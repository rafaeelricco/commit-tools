export { Update };

import * as p from "@clack/prompts";
import color from "picocolors";

import { Future } from "@/libs/future";
import { execBinInteractive } from "@/infra/shell";

const PACKAGE_NAME = "@rafaeelricco/commit-tools";

type PackageManager = { name: "pnpm" | "yarn" | "npm"; cmd: string; args: string[] };

const detectPackageManager = (binPath: string): PackageManager => {
  const path = binPath.toLowerCase();
  if (path.includes("pnpm")) return { name: "pnpm", cmd: "pnpm", args: ["add", "-g", `${PACKAGE_NAME}@latest`] };
  if (path.includes(".yarn") || path.includes("/yarn/") || path.includes("\\yarn\\"))
    return { name: "yarn", cmd: "yarn", args: ["global", "add", `${PACKAGE_NAME}@latest`] };
  return { name: "npm", cmd: "npm", args: ["install", "-g", `${PACKAGE_NAME}@latest`] };
};

class Update {
  private constructor() {}

  static create(): Update {
    return new Update();
  }

  run(): Future<Error, void> {
    const pm = detectPackageManager(process.argv[1] ?? "");
    p.note(`Running: ${color.cyan(`${pm.cmd} ${pm.args.join(" ")}`)}`, "Updating commit-tools");
    return execBinInteractive(pm.cmd, pm.args).mapRej((err) => new Error(`Update failed: ${err.message}`));
  }
}
