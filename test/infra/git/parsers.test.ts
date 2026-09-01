import { describe, expect, it } from "vitest";
import {
  parsePushRange,
  formatCommitOutput,
  parseBaseFromReflog,
  splitCommitFields,
  parseRemoteFromUpstream,
  commandFailureMessage,
  parseHookInterpreter,
  isGeneratedPath,
  parseNumstatCounts,
  formatOmittedPaths
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
    if (result instanceof Success) expect(result.value["subject"]).toBe("subject");
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

describe("parseHookInterpreter", () => {
  it("defaults to sh without a shebang", () => {
    expect(parseHookInterpreter("exit 0")).toBe("sh");
  });

  it("uses env program and path basename", () => {
    expect(parseHookInterpreter("#!/usr/bin/env python3")).toBe("python3");
    expect(parseHookInterpreter("#! /usr/bin/env node")).toBe("node");
    expect(parseHookInterpreter("#!/usr/bin/env")).toBe("sh");
  });

  it("uses the interpreter basename for direct shebangs", () => {
    expect(parseHookInterpreter("#!/bin/sh")).toBe("sh");
    expect(parseHookInterpreter("#!/bin/bash")).toBe("bash");
    expect(parseHookInterpreter("#!/usr/bin/python")).toBe("python");
  });
});

describe("isGeneratedPath", () => {
  it("matches lockfiles, build output, and snapshots", () => {
    for (const p of ["pnpm-lock.yaml", "web/package-lock.json", "dist/app.js", "src/__snapshots__/a.snap", "a.min.css"]) {
      expect(isGeneratedPath(p)).toBe(true);
    }
  });

  it("keeps source paths that merely resemble generated ones", () => {
    for (const p of ["src/distributed.ts", "src/outbox.ts", "lock.ts", "app/[id]/page.tsx"]) {
      expect(isGeneratedPath(p)).toBe(false);
    }
  });
});

describe("formatOmittedPaths", () => {
  it("renders churn per omitted path and empty for none", () => {
    const counts = parseNumstatCounts("412\t87\tpnpm-lock.yaml\0-\t-\tdist/logo.png\0");
    expect(formatOmittedPaths(["pnpm-lock.yaml"], counts)).toContain("pnpm-lock.yaml | +412 -87 (generated, body omitted)");
    expect(formatOmittedPaths(["dist/logo.png"], counts)).toContain("dist/logo.png | binary (generated, body omitted)");
    expect(formatOmittedPaths([], counts)).toBe("");
  });
});
