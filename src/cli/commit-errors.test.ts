import { describe, expect, it } from "vitest";
import { isNonFastForwardError } from "@/cli/commit-errors";

describe("isNonFastForwardError", () => {
  it.each(["error: failed to push: non-fast-forward", "Updates were rejected because the tip of your current branch is behind"])(
    "detects: %s",
    (message) => {
      expect(isNonFastForwardError(new Error(message))).toBe(true);
    }
  );

  it("returns false for unrelated errors", () => {
    expect(isNonFastForwardError(new Error("authentication failed"))).toBe(false);
  });
});
