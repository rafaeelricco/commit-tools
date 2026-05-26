import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@clack/prompts", () => ({
  note: vi.fn()
}));

import { renderBranchNote } from "@/infra/ui/push-note";
import { Just, Nothing } from "@/libs/maybe";
import * as p from "@clack/prompts";

describe("renderBranchNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("renders branch, base, and full request metadata", () => {
    renderBranchNote({
      branch: "ai-branch-creator",
      baseBranch: Just("main"),
      request: Just({
        durationMs: 11400,
        model: { provider: "anthropic", model: "claude-opus-4-7", effort: "max" },
        tokens: Just({
          input: Just(13026),
          output: Just(478),
          total: Just(13504)
        })
      })
    });

    expect(p.note).toHaveBeenCalledWith(
      [
        "branch   ai-branch-creator",
        "base     main",
        "model    claude-opus-4-7 with max effort",
        "request  11.4s",
        "tokens   input 13,026  output 478  total 13,504"
      ].join("\n"),
      "Branched"
    );
  });

  it("omits base when unavailable", () => {
    renderBranchNote({
      branch: "auth-wiring",
      baseBranch: Nothing(),
      request: Just({
        durationMs: 500,
        model: { provider: "openai", model: "gpt-4.1-mini", effort: "medium" },
        tokens: Nothing()
      })
    });

    expect(p.note).toHaveBeenCalledWith(
      ["branch   auth-wiring", "model    gpt-4.1-mini with medium effort", "request  500ms", "tokens   unavailable"].join("\n"),
      "Branched"
    );
  });

  it("shows branch and base when request metadata is unavailable", () => {
    renderBranchNote({
      branch: "login-form-ui",
      baseBranch: Just("main"),
      request: Nothing()
    });

    expect(p.note).toHaveBeenCalledWith(["branch   login-form-ui", "base     main"].join("\n"), "Branched");
  });
});
