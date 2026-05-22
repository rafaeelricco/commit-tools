import { describe, expect, it } from "vitest";
import { parseArgs } from "@/cli/parser";
import { Failure, Success } from "@/libs/result";

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

  it("defaults bare invocation to generate", () => {
    const result = parseArgs([]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success) expect(result.value.type).toBe("generate");
  });
});
