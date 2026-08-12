import { describe, expect, it } from "vitest";
import { parseArgs } from "@/cli/parser";
import { ALIAS_TARGETS } from "@/domain/alias/alias";
import { Failure, Success } from "@/libs/result";

describe("parseArgs", () => {
  it.each([
    [["generate"], "generate"],
    [["split"], "split"],
    [["branch"], "branch"],
    [["new-branch"], "branch"],
    [["setup"], "setup"],
    [["login"], "setup"],
    [["doctor"], "doctor"],
    [["model"], "model"],
    [["effort"], "effort"],
    [["update"], "update"],
    [["alias"], "alias"],
    [["aliases"], "alias"],
    [["alias", "list"], "alias"],
    [["alias", "ls"], "alias"],
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

describe("parseArgs alias", () => {
  // A shim passes its bound target straight back as argv[0], so every target must parse as a command.
  it.each(ALIAS_TARGETS)("target %s parses as a command", (target) => {
    expect(parseArgs([target]).isSuccess()).toBe(true);
  });

  it.each([
    [["alias"], { type: "hub" }],
    [["alias", "list"], { type: "list" }],
    [["alias", "add", "cb", "branch"], { type: "add", name: "cb", target: "branch" }],
    [["alias", "new", "cm", "generate"], { type: "add", name: "cm", target: "generate" }],
    [["alias", "remove", "cb"], { type: "remove", name: "cb" }],
    [["alias", "rm", "cb"], { type: "remove", name: "cb" }]
  ] as const)("maps %j to %j", (argv, action) => {
    const result = parseArgs([...argv]);
    expect(result.isSuccess()).toBe(true);
    if (result instanceof Success && result.value.type === "alias") expect(result.value.action).toEqual(action);
  });

  it.each([
    [["alias", "add", "cb", "nope"], /must be one of/],
    [["alias", "add", "cb"], /Usage: commit alias add/],
    [["alias", "remove"], /Usage: commit alias remove/],
    [["alias", "wat"], /Unknown alias subcommand/]
  ] as const)("rejects %j", (argv, message) => {
    const result = parseArgs([...argv]);
    expect(result.isFailure()).toBe(true);
    if (result instanceof Failure) expect(result.error.message).toMatch(message);
  });
});
