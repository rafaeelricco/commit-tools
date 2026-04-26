export { checkUpdate };

import { checkForUpdate, compareVersions } from "@/infra/version-check";
import { renderUpdateBanner } from "@/infra/ui/update-banner";
import { version } from "@/package.json";

const isOptedOut = (): boolean => process.env["NO_UPDATE_NOTIFIER"] === "true";
const isCi = (): boolean => Boolean(process.env["CI"]);
const isNonInteractive = (): boolean => !process.stdout.isTTY;

const shouldSuppress = (): boolean => isOptedOut() || isCi() || isNonInteractive();

const checkUpdate = (): void => {
  if (shouldSuppress()) return;
  const current = version;
  checkForUpdate().maybe(undefined, (latest) => {
    if (compareVersions(latest, current) > 0) renderUpdateBanner({ current, latest });
  });
};
