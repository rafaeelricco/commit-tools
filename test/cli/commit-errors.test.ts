import { describe, expect, it } from "vitest";
import { Commit } from "@/cli/commit";

describe("isNonFastForwardError", () => {
  it.each(["error: failed to push: non-fast-forward", "Updates were rejected because the tip of your current branch is behind"])(
    "detects: %s",
    (message) => {
      expect(Commit.isNonFastForwardError(new Error(message))).toBe(true);
    }
  );

  it("returns false for unrelated errors", () => {
    expect(Commit.isNonFastForwardError(new Error("Some other error"))).toBe(false);
  });
});
