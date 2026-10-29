import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-secret" }
}));

import { Doctor } from "@/cli/doctor";
import * as pr from "@/infra/github/pr";
import { Future } from "@/libs/future";
import { Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

vi.mock("@/infra/storage/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infra/storage/config")>();
  return { ...actual, loadConfig: vi.fn(() => Future.reject(new Error("missing"))) };
});
vi.mock("@/infra/git/repo", () => ({
  checkIsGitRepo: vi.fn(() => Future.resolve(undefined)),
  findCurrentBranch: vi.fn(() => Future.resolve(Just("main"))),
  findBaseBranch: vi.fn(() => Future.resolve(Just("main"))),
  findTrackingRemoteUrl: vi.fn(() => Future.resolve(Just("https://github.com/o/r.git")))
}));
vi.mock("@/infra/github/pr", () => ({
  getOpenPullRequest: vi.fn(() => Future.resolve({ type: "not-found" as const }))
}));

describe("Doctor.run", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("completes when config file is missing", async () => {
    await expect(runFuture(Doctor.create().run())).resolves.toBeUndefined();
  });

  it("links the truncated PR cell to the full url on a TTY", async () => {
    const url = "https://github.com/rafaeelricco/commit-tools/pull/42";
    vi.mocked(pr.getOpenPullRequest).mockReturnValueOnce(Future.resolve({ type: "found" as const, pr: { number: 42, url } }));
    const isTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runFuture(Doctor.create().run());
    const out = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    write.mockRestore();
    if (isTTY) Object.defineProperty(process.stdout, "isTTY", isTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    expect(out).toContain(`\u001B]8;;${url}\u0007#42 https://github.com/`);
    expect(out).toContain("…");
  });
});
