import { describe, expect, it } from "vitest";
import { ALIAS_TARGETS, AliasName, addAlias, describeTarget, findAlias, removeAlias, type Alias } from "@/domain/alias/alias";
import { Failure, Success } from "@/libs/result";
import { Just, Nothing } from "@/libs/maybe";

const name = (raw: string): AliasName => {
  const parsed = AliasName.parse(raw);
  if (parsed instanceof Failure) throw new Error(`fixture name ${raw} is invalid: ${parsed.error}`);
  return parsed.value;
};

const alias = (raw: string, target: Alias["target"] = "generate"): Alias => ({ name: name(raw), target });

describe("AliasName.parse", () => {
  it.each([
    ["cb", "cb"],
    ["c", "c"],
    ["gen-msg", "gen-msg"],
    ["my_alias", "my_alias"],
    ["A1", "a1"],
    ["a".repeat(32), "a".repeat(32)]
  ])("accepts %s as %s", (raw, expected) => {
    const parsed = AliasName.parse(raw);
    expect(parsed instanceof Success && parsed.value.value).toBe(expected);
  });

  it("trims surrounding whitespace", () => {
    const parsed = AliasName.parse("  cb  ");
    expect(parsed instanceof Success && parsed.value.value).toBe("cb");
  });

  it("normalizes names to lowercase", () => {
    const parsed = AliasName.parse("CB");
    expect(parsed instanceof Success && parsed.value.value).toBe("cb");
  });

  it.each([
    ["", "empty"],
    ["1cb", "leading digit"],
    ["../etc/passwd", "path traversal"],
    ["a/b", "path separator"],
    ["a b", "space"],
    ["a".repeat(33), "too long"],
    ["rm -rf", "shell metacharacters"]
  ])("rejects %s (%s)", (raw) => {
    expect(AliasName.parse(raw).isFailure()).toBe(true);
  });

  it.each([["commit"], ["commit-tools"], ["Commit"], ["COMMIT-TOOLS"]])("rejects reserved name %s", (raw) => {
    const parsed = AliasName.parse(raw);
    expect(parsed instanceof Failure && parsed.error).toContain("reserved");
  });
});

describe("addAlias", () => {
  it("appends when the name is free", () => {
    const result = addAlias([alias("cb", "branch")], alias("cm"));
    expect(result instanceof Success && result.value.map((a) => a.name.value)).toEqual(["cb", "cm"]);
  });

  it("rejects a duplicate instead of overwriting", () => {
    const existing = [alias("cb", "branch")];
    const result = addAlias(existing, alias("cb", "setup"));
    expect(result instanceof Failure && result.error).toContain("already exists");
    expect(existing[0]?.target).toBe("branch");
  });

  it("rejects a case-folded duplicate", () => {
    const existing = [alias("cb", "branch")];
    const result = addAlias(existing, alias("CB", "setup"));
    expect(result instanceof Failure && result.error).toContain("already exists");
  });
});

describe("removeAlias", () => {
  it("removes an existing alias", () => {
    const result = removeAlias([alias("cb"), alias("cm")], name("cb"));
    expect(result instanceof Success && result.value.map((a) => a.name.value)).toEqual(["cm"]);
  });

  it("fails on an unknown name rather than reporting a silent success", () => {
    const result = removeAlias([alias("cb")], name("nope"));
    expect(result instanceof Failure && result.error).toContain("No alias named 'nope'");
  });
});

describe("findAlias", () => {
  it("matches by value, not identity", () => {
    expect(findAlias([alias("cb")], name("cb"))).toBeInstanceOf(Just);
    expect(findAlias([alias("cb")], name("cm"))).toBeInstanceOf(Nothing);
  });
});

describe("describeTarget", () => {
  it("describes every target", () => {
    for (const target of ALIAS_TARGETS) expect(describeTarget(target).length).toBeGreaterThan(0);
  });
});
