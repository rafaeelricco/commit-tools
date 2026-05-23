import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/infra/env", () => ({
  environment: { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test" }
}));

import { Doctor } from "@/cli/doctor";
import { Future } from "@/libs/future";
import { runFuture } from "@test/helpers/run-future";

vi.mock("@/infra/storage/config", () => ({
  configFile: () => "/tmp/config.json",
  loadConfig: vi.fn()
}));
vi.mock("@/infra/git/repo", () => ({
  checkIsGitRepo: vi.fn(() => Future.reject(new Error("not a repo"))),
  findCurrentBranch: vi.fn(),
  findBaseBranch: vi.fn()
}));
vi.mock("@/infra/github/pr", () => ({
  getOpenPullRequest: vi.fn(() => Future.resolve({ type: "unavailable" }))
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(() => Promise.reject(new Error("missing")))
}));

describe("Doctor.run --json", () => {
  let stdout: string;

  beforeEach(() => {
    stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits checks JSON on stdout", async () => {
    await runFuture(Doctor.create().run({ json: true }));
    const line = stdout.trim().split("\n").find((l) => l.startsWith("{"));
    expect(line).toBeDefined();
    const parsed = JSON.parse(line!);
    expect(parsed.command).toBe("doctor");
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.some((c: { name: string }) => c.name === "CLI Version")).toBe(true);
  });
});
