export { renderUpdateBanner };

import * as p from "@clack/prompts";
import color from "picocolors";

type UpdateInfo = { current: string; latest: string };

const renderUpdateBanner = (info: UpdateInfo): void => {
  const body = [
    `${color.dim(info.current)} ${color.dim("→")} ${color.green(info.latest)}`,
    ``,
    `Run ${color.cyan("commit update")} to install the latest version.`,
    color.dim(`Changelog: https://npm.im/@rafaeelricco/commit-tools`)
  ].join("\n");
  p.note(body, "Update available");
};
