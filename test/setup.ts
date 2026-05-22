import { beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Static env at module load — before test files import modules that read env at import time (src/infra/env.ts).
process.env["NO_UPDATE_NOTIFIER"] = "true";
process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";

// Fresh config home per test; config paths are read lazily, so this isolates each test.
beforeEach(() => {
  process.env["COMMIT_TOOLS_HOME"] = mkdtempSync(join(tmpdir(), "commit-tools-test-"));
});
