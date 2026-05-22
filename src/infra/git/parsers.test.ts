import { describe, expect, it } from "vitest";
import {
  parsePushRange,
  formatCommitOutput,
  parseBaseFromReflog,
  splitCommitFields,
  parseRemoteFromUpstream,
  commandFailureMessage
} from "@/infra/git/parsers";
import { Just, Nothing } from "@/libs/maybe";
import { Success } from "@/libs/result";

describe("parsePushRange", () => {
  it("parses before..after from push output", () => {
    const range = parsePushRange("To origin\n   abcdef0..1234567  main -> main\n");
    expect(range).toBeInstanceOf(Just);
    if (range instanceof Just) {
      expect(range.value.before).toBe("abcdef0");
      expect(range.value.after).toBe("1234567");
    }
  });

  it("returns Nothing when no range", () => {
    expect(parsePushRange("Everything up-to-date")).toBeInstanceOf(Nothing);
  });
});

describe("parseBaseFromReflog", () => {
  it("extracts branch from creation reflog line", () => {
    const stdout = "branch: Fast-forward\nbranch: Created from origin/main\n";
    expect(parseBaseFromReflog(stdout)).toEqual(Success("origin/main"));
  });

  it("fails when reflog has no creation line", () => {
    const result = parseBaseFromReflog("branch: Fast-forward\n");
    expect(result.isFailure()).toBe(true);
  });
});

describe("splitCommitFields", () => {
  it("maps NUL-separated git log fields", () => {
    const line = ["abc", "abc", "subject", "me", "me@x.com", "2024-01-01T00:00:00+00:00"].join("\0");
    const result = splitCommitFields(`${line}\n`);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) expect(result.value["subject"]).toBe("subject");
  });
});

describe("formatCommitOutput", () => {
  it("strips bracketed progress lines", () => {
    const out = formatCommitOutput("[main abc1234] feat: x\n 1 file changed\n");
    expect(out).toContain("1 file changed");
    expect(out).not.toContain("[main");
  });
});

describe("parseRemoteFromUpstream", () => {
  it("parses origin from origin/main", () => {
    expect(parseRemoteFromUpstream("origin/main")).toEqual(Just("origin"));
  });
});

describe("commandFailureMessage", () => {
  it("prefers stderr over stdout", () => {
    const msg = commandFailureMessage({ output: { stderr: "fatal: no repo", stdout: "" }, error: new Error("exit 128") }, "fallback");
    expect(msg).toBe("fatal: no repo");
  });
});
