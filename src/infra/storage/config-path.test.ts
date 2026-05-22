import { describe, expect, it } from "vitest";
import { CONFIG_FILE } from "@/infra/storage/config";

describe("config paths", () => {
  it("honors COMMIT_TOOLS_HOME set in test setup", () => {
    const home = process.env["COMMIT_TOOLS_HOME"];
    expect(home).toBeTruthy();
    expect(CONFIG_FILE()).toContain("commit-tools-test-");
    expect(CONFIG_FILE().startsWith(home!)).toBe(true);
  });
});
