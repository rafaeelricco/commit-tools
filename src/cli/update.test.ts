import { describe, expect, it, vi } from "vitest";
import { detectPackageManager } from "@/cli/update";
import { Future } from "@/libs/future";
import { Success } from "@/libs/result";
import { runFuture } from "../../../test/helpers/run-future";

vi.mock("@/infra/shell", () => ({
  execBin: vi.fn()
}));

describe("detectPackageManager", () => {
  it("selects pnpm when bin path contains pnpm", async () => {
    const pm = await runFuture(detectPackageManager("/Users/x/.local/share/pnpm/commit"));
    expect(pm.name).toBe("pnpm");
  });

  it("selects npm for generic node path", async () => {
    const pm = await runFuture(detectPackageManager("/usr/local/bin/node"));
    expect(pm.name).toBe("npm");
  });

  it("selects yarn 1 when yarn path and version is 1.x", async () => {
    const { execBin } = await import("@/infra/shell");
    vi.mocked(execBin).mockReturnValue(Future.resolve(Success({ stdout: "1.22.0\n", stderr: "" })));
    const pm = await runFuture(detectPackageManager("/Users/x/.yarn/bin/commit"));
    expect(pm.name).toBe("yarn");
  });
});
