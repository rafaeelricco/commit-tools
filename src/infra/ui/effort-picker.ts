export { selectOpenAIEffort, selectAnthropicEffort, selectGeminiEffort, selectXaiEffort };

import { ThinkingLevel } from "@google/genai";

import { Future } from "@/libs/future";
import { Just, type Maybe } from "@/libs/maybe";
import {
  OPENAI_EFFORTS,
  ANTHROPIC_EFFORTS,
  GEMINI_EFFORTS,
  XAI_EFFORTS,
  type OpenAIEffort,
  type OpenAIModelEffort,
  type AnthropicEffort,
  type GeminiEffort,
  type XaiEffort
} from "@/domain/config/config";

type EffortSliderModule = typeof import("@/infra/ui/effort-slider");

const selectEffort = <V extends string>(
  options: readonly [V, ...V[]],
  modelId: string,
  currentEffort: Maybe<V>,
  defaultValue: V
): Future<Error, Maybe<V>> => {
  const normalizedCurrent = currentEffort.map((value) => (options.includes(value) ? value : defaultValue));
  const initialIndex = normalizedCurrent.maybe(options.indexOf(defaultValue), (value) => options.indexOf(value));

  return Future.attemptP(async () => {
    // Lazy-load Ink/React so non-interactive CLI paths don't pay their startup cost.
    // Ink pulls in React, Yoga layout, and a render loop — non-trivial to initialize
    // even for commands that never reach an interactive prompt (scripted runs,
    // --yes flows, piped stdin, git hook integrations). A static top-level import
    // would charge every CLI entrypoint for that cost regardless of whether the
    // picker is ever shown; dynamic import defers it until the user actually
    // reaches this code path.
    const { render } = await import("ink");
    const React = await import("react");
    const sliderModule: EffortSliderModule = await import("@/infra/ui/effort-slider");
    return { render, React, sliderModule };
  }).chain(({ render, React, sliderModule }) =>
    Future.create<Error, Maybe<V>>((_reject, resolve) => {
      const { unmount } = render(
        React.createElement(sliderModule.EffortSlider<V>, {
          title: `Reasoning effort for ${modelId}`,
          options,
          initialIndex,
          onSubmit: (value: V) => {
            unmount();
            resolve(Just(value));
          },
          onCancel: () => {
            unmount();
            resolve(normalizedCurrent);
          }
        })
      );
      return () => unmount();
    })
  );
};

const selectOpenAIEffort = (modelId: string, current: Maybe<OpenAIEffort>, modelEffort: Maybe<OpenAIModelEffort>): Future<Error, Maybe<OpenAIEffort>> => {
  const { options, defaultValue } = modelEffort.withDefault({ options: OPENAI_EFFORTS, defaultValue: "medium" });
  return selectEffort(options, modelId, current, defaultValue);
};

const selectAnthropicEffort = (modelId: string, current: Maybe<AnthropicEffort>): Future<Error, Maybe<AnthropicEffort>> =>
  selectEffort<AnthropicEffort>(ANTHROPIC_EFFORTS, modelId, current, "medium");

const selectGeminiEffort = (modelId: string, current: Maybe<GeminiEffort>): Future<Error, Maybe<GeminiEffort>> =>
  selectEffort<GeminiEffort>(GEMINI_EFFORTS, modelId, current, ThinkingLevel.MEDIUM);

const selectXaiEffort = (modelId: string, current: Maybe<XaiEffort>): Future<Error, Maybe<XaiEffort>> =>
  selectEffort<XaiEffort>(XAI_EFFORTS, modelId, current, "high");
