import { describe, expect, it } from "vitest";
import { compareVersions } from "@/infra/version-check";

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.2.0", "1.1.9", 1],
    ["0.2.9", "0.3.0", -1],
    ["2.0.0-beta.1", "2.0.0", 0],
    ["10.0.0", "9.9.9", 1]
  ] as const)("%s vs %s => %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });
});
