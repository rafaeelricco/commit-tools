import { beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

beforeEach(() => {
  process.env["COMMIT_TOOLS_HOME"] = mkdtempSync(join(tmpdir(), "commit-tools-test-"));
  process.env["NO_UPDATE_NOTIFIER"] = "true";
  process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
});
