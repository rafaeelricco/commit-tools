import { describe, expect, it } from "vitest";
import { extractResponse } from "@/domain/llm/response-parser";
import { Just, Nothing } from "@/libs/maybe";
import { runFuture } from "../../../test/helpers/run-future";

describe("extractResponse", () => {
  it("trims and returns non-empty text", async () => {
    const text = await runFuture(extractResponse({ text: Just("  hello  ") }));
    expect(text).toBe("hello");
  });

  it("rejects empty string", async () => {
    await expect(runFuture(extractResponse({ text: Just("") }))).rejects.toThrow(/empty or missing/);
  });

  it("rejects missing text", async () => {
    await expect(runFuture(extractResponse({ text: Nothing() }))).rejects.toThrow(/empty or missing/);
  });
});
