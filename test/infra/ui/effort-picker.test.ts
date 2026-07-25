import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectOpenAIEffort } from "@/infra/ui/effort-picker";
import { Just } from "@/libs/maybe";
import { runFuture } from "@test/helpers/run-future";

const render = vi.hoisted(() => vi.fn());

vi.mock("ink", () => ({ render }));
vi.mock("@/infra/ui/effort-slider", () => ({ EffortSlider: () => null }));

type SliderProps = {
  readonly options: readonly string[];
  readonly onSubmit: (value: "low" | "medium" | "high" | "xhigh") => void;
  readonly onCancel: () => void;
};

const capabilities = Just({ options: ["low", "medium", "high", "xhigh"] as const, defaultValue: "low" as const });

describe("selectOpenAIEffort", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes catalog capabilities to the effort slider", async () => {
    render.mockImplementation((element: { props: SliderProps }) => {
      queueMicrotask(() => element.props.onSubmit("high"));
      return { unmount: vi.fn() };
    });

    const result = await runFuture(selectOpenAIEffort("gpt-5.6-sol", Just("minimal"), capabilities));

    expect(render.mock.calls[0]?.[0].props.options).toEqual(["low", "medium", "high", "xhigh"]);
    expect(result.expect("Expected selected effort")).toBe("high");
  });

  it("normalizes a stale effort to the model default on cancel", async () => {
    render.mockImplementation((element: { props: SliderProps }) => {
      queueMicrotask(() => element.props.onCancel());
      return { unmount: vi.fn() };
    });

    const result = await runFuture(selectOpenAIEffort("gpt-5.6-sol", Just("minimal"), capabilities));

    expect(result.expect("Expected normalized effort")).toBe("low");
  });
});
