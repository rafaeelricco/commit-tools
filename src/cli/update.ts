export { Update };

import * as p from "@clack/prompts";
import color from "picocolors";

import { Future } from "@/libs/future";
import { execBin, execBinInteractive } from "@/infra/shell";

const PACKAGE_NAME = "@rafaeelricco/commit-tools";

type PackageManager = { name: "pnpm" | "yarn" | "npm"; cmd: string; args: string[] };
type ShellCommand = { cmd: string; args: string[] };

const updateCommand = `${PACKAGE_NAME}@latest`;
const pnpmPackageManager: PackageManager = { name: "pnpm", cmd: "pnpm", args: ["add", "-g", updateCommand] };
const yarnPackageManager: PackageManager = { name: "yarn", cmd: "yarn", args: ["global", "add", updateCommand] };
const npmPackageManager: PackageManager = { name: "npm", cmd: "npm", args: ["install", "-g", updateCommand] };

const isYarnPath = (path: string): boolean => path.includes(".yarn") || path.includes("/yarn/") || path.includes("\\yarn\\");

const yarnVersionCommand = (): ShellCommand =>
  process.platform === "win32" ? { cmd: "cmd", args: ["/d", "/s", "/c", "yarn --version"] } : { cmd: "yarn", args: ["--version"] };

const parseMajorVersion = (version: string): number | undefined => {
  const major = version.trim().match(/^(\d+)\./)?.[1];
  return major ? Number(major) : undefined;
};

const unsupportedYarnError = (): Error =>
  new Error(
    [
      "Modern Yarn does not support global installs.",
      `Install the latest commit-tools with ${color.cyan(`npm install -g ${updateCommand}`)} or ${color.cyan(`pnpm add -g ${updateCommand}`)}.`
    ].join("\n")
  );

const resolveYarnPackageManager = (): Future<Error, PackageManager> => {
  const versionCommand = yarnVersionCommand();
  return execBin(versionCommand.cmd, versionCommand.args)
    .chain((result) =>
      result.either(
        (): Future<Error, PackageManager> => Future.reject(unsupportedYarnError()),
        ({ stdout }): Future<Error, PackageManager> => {
          const major = parseMajorVersion(stdout);
          return major === 1 ? Future.resolve(yarnPackageManager) : Future.reject(unsupportedYarnError());
        }
      )
    )
    .chainRej((): Future<Error, PackageManager> => Future.reject(unsupportedYarnError()));
};

const detectPackageManager = (binPath: string): Future<Error, PackageManager> => {
  const path = binPath.toLowerCase();
  if (path.includes("pnpm")) return Future.resolve(pnpmPackageManager);
  if (isYarnPath(path)) return resolveYarnPackageManager();
  return Future.resolve(npmPackageManager);
};

class Update {
  private constructor() {}

  static create(): Update {
    return new Update();
  }

  run(): Future<Error, void> {
    return detectPackageManager(process.argv[1] ?? "")
      .chainRej((err): Future<Error, PackageManager> => {
        p.note(err.message, "Yarn global installs unsupported");
        return Future.reject(err);
      })
      .chain((pm): Future<Error, void> => {
        p.note(`Running: ${color.cyan(`${pm.cmd} ${pm.args.join(" ")}`)}`, "Updating commit-tools");
        return execBinInteractive(pm.cmd, pm.args).mapRej((err) => new Error(`Update failed: ${err.message}`));
      });
  }
}
