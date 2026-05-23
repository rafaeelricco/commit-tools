import { describe, expect, it } from "vitest";
import { parseArgs } from "@/cli/parser";
import { Failure, Success } from "@/libs/result";
import { Nothing } from "@/libs/maybe";

describe("parseArgs", () => {
  it.each([
    [["generate"], "generate"],
    [["setup"], "setup"],
    [["login"], "setup"],
    [["doctor"], "doctor"],
    [["model"], "model"],
    [["effort"], "effort"],
    [["update"], "update"],
    [["-v"], "version"],
    [["--version"], "version"],
    [["-h"], "help"],
    [["--help"], "help"]
  ] as const)("maps %j to %s", (argv, type) => {
    const result = parseArgs([...argv]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success) expect(result.value.type).toBe(type);
  });

  it("rejects unknown commands", () => {
    const result = parseArgs(["wat"]);
    expect(result.isFailure()).toBe(true);
    if (result instanceof Failure) expect(result.error.message).toContain("Unknown command");
  });

  it("defaults bare invocation to interactive generate", () => {
    const result = parseArgs([]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success) {
      expect(result.value.type).toBe("generate");
      if (result.value.type === "generate") expect(result.value.mode.type).toBe("interactive");
    }
  });

  it("parses generate --json", () => {
    const result = parseArgs(["generate", "--json"]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success && result.value.type === "generate") {
      expect(result.value.mode).toEqual({
        type: "json",
        adjust: Nothing(),
        dryRun: false,
        git: { type: "none" }
      });
    }
  });

  it("parses commit --json --commit --push as generate", () => {
    const result = parseArgs(["--json", "--commit", "--push"]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success && result.value.type === "generate") {
      expect(result.value.mode.type).toBe("json");
      if (result.value.mode.type === "json") {
        expect(result.value.mode.git).toEqual({ type: "commit_push", yes: false });
      }
    }
  });

  it("rejects --push without --commit", () => {
    const result = parseArgs(["generate", "--json", "--push"]);
    expect(result.isFailure()).toBe(true);
  });

  it("rejects --commit without --json", () => {
    const result = parseArgs(["generate", "--commit"]);
    expect(result.isFailure()).toBe(true);
  });

  it("parses doctor --json", () => {
    const result = parseArgs(["doctor", "--json"]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success && result.value.type === "doctor") {
      expect(result.value.json).toBe(true);
    }
  });
});
