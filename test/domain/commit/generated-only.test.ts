import { describe, expect, it } from "vitest";
import { generatedOnlyMessage } from "@/domain/commit/generated-only";

describe("generatedOnlyMessage", () => {
  it("names a single file with a chore prefix under conventional", () => {
    expect(generatedOnlyMessage(["web/pnpm-lock.yaml"], "conventional")).toBe("chore: update pnpm-lock.yaml");
  });
  it("uses an imperative title otherwise", () => {
    expect(generatedOnlyMessage(["pnpm-lock.yaml"], "imperative")).toBe("Update pnpm-lock.yaml");
    expect(generatedOnlyMessage(["pnpm-lock.yaml"], "custom")).toBe("Update pnpm-lock.yaml");
  });
  it("lists several files as bullets", () => {
    expect(generatedOnlyMessage(["pnpm-lock.yaml", "dist/app.js"], "imperative")).toBe("Update generated files\n\n- pnpm-lock.yaml.\n- dist/app.js.");
  });
});
