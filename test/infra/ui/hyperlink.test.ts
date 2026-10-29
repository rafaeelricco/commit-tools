import { describe, expect, it } from "vitest";
import { hyperlink } from "@/infra/ui/hyperlink";

describe("hyperlink", () => {
  it("wraps an http(s) url in an OSC-8 link when enabled", () => {
    expect(hyperlink("https://github.com/o/r/pull/1", "#1", true)).toBe("\u001B]8;;https://github.com/o/r/pull/1\u0007#1\u001B]8;;\u0007");
  });

  it("returns plain text when disabled", () => {
    expect(hyperlink("https://github.com/o/r/pull/1", "https://github.com/o/r/pull/1", false)).toBe("https://github.com/o/r/pull/1");
  });

  it("leaves non-http remotes as text", () => {
    expect(hyperlink("git@github.com:o/r.git", "git@github.com:o/r.git", true)).toBe("git@github.com:o/r.git");
  });
});
