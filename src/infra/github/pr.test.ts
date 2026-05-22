import { describe, expect, it, vi, beforeEach } from "vitest";
import { getOpenPullRequest } from "@/infra/github/pr";
import { Future } from "@/libs/future";
import { Success, Failure } from "@/libs/result";
import { runFuture } from "../../../test/helpers/run-future";

vi.mock("@/infra/git/repo", () => ({
  getTrackingRemoteUrl: vi.fn(() => Future.resolve("https://github.com/o/r.git")),
  getCurrentBranch: vi.fn(() => Future.resolve("feature/x"))
}));

vi.mock("@/infra/shell", () => ({
  execBin: vi.fn()
}));

describe("getOpenPullRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns found when gh outputs valid JSON", async () => {
    const { execBin } = await import("@/infra/shell");
    vi.mocked(execBin).mockReturnValue(
      Future.resolve(
        Success({
          stdout: JSON.stringify({ url: "https://github.com/o/r/pull/1", number: 1 }),
          stderr: ""
        })
      )
    );

    const lookup = await runFuture(getOpenPullRequest());
    expect(lookup).toEqual({ type: "found", pr: { url: "https://github.com/o/r/pull/1", number: 1 } });
  });

  it("returns not-found when gh stderr says no PR", async () => {
    const { execBin } = await import("@/infra/shell");
    vi.mocked(execBin).mockReturnValue(
      Future.resolve(
        Failure({
          output: { stderr: "no pull requests found for branch", stdout: "" },
          error: new Error("exit 1")
        })
      )
    );

    const lookup = await runFuture(getOpenPullRequest());
    expect(lookup.type).toBe("not-found");
  });

  it("returns unavailable for non-github remote", async () => {
    const repo = await import("@/infra/git/repo");
    vi.mocked(repo.getTrackingRemoteUrl).mockReturnValue(Future.resolve("git@gitlab.com:o/r.git"));

    const lookup = await runFuture(getOpenPullRequest());
    expect(lookup.type).toBe("unavailable");
  });
});
