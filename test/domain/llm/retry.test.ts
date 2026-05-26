import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withTransientRetry, isTransientLlmError } from "@/domain/llm/retry";
import { Future } from "@/libs/future";
import { runFuture } from "@test/helpers/run-future";

vi.mock("@clack/prompts", () => ({
  log: { warn: vi.fn() },
  confirm: vi.fn(async () => false),
  isCancel: vi.fn(() => false)
}));

describe("isTransientLlmError", () => {
  it("matches 'terminated' error", () => {
    expect(isTransientLlmError(new Error("Failed to create Anthropic message: terminated"))).toBe(true);
  });

  it("matches err.cause message", () => {
    const cause = new Error("ECONNRESET");
    expect(isTransientLlmError(new Error("Wrapped", { cause }))).toBe(true);
  });

  it("matches 503", () => {
    expect(isTransientLlmError(new Error("Server returned 503"))).toBe(true);
  });

  it("does not match auth errors", () => {
    expect(isTransientLlmError(new Error("401 unauthorized"))).toBe(false);
  });
});

describe("withTransientRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on first try without retrying", async () => {
    const make = vi.fn(() => Future.resolve<Error, string>("ok"));
    const result = await runFuture(withTransientRetry(make));
    expect(result).toBe("ok");
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("retries transient error twice then succeeds", async () => {
    let calls = 0;
    const make = vi.fn((): Future<Error, string> => {
      calls += 1;
      if (calls < 3) return Future.reject(new Error("terminated"));
      return Future.resolve("ok");
    });
    const promise = runFuture(withTransientRetry(make));
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("ok");
    expect(make).toHaveBeenCalledTimes(3);
  });

  it("fails immediately on non-transient error", async () => {
    const make = vi.fn(() => Future.reject<Error, string>(new Error("401 unauthorized")));
    await expect(runFuture(withTransientRetry(make))).rejects.toThrow("401 unauthorized");
    expect(make).toHaveBeenCalledTimes(1);
  });
});
