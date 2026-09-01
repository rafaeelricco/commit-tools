export { generatedOnlyMessage };

import { type CommitConvention } from "@/domain/config/config";

const basename = (path: string): string => path.split("/").at(-1) ?? path;

const generatedOnlyMessage = (files: readonly string[], convention: CommitConvention): string => {
  const verb = convention === "conventional" ? "chore: update" : "Update";
  const [only] = files;
  return only !== undefined && files.length === 1 ?
      `${verb} ${basename(only)}`
    : `${verb} generated files\n\n${files.map((path) => `- ${path}.`).join("\n")}`;
};
