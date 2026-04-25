export { selectOpenAIEffort, selectAnthropicEffort, selectGeminiEffort };

import { ThinkingLevel } from "@google/genai";

import { Future } from "@/libs/future";
import { Just, Nothing, type Maybe } from "@/libs/maybe";
import { OPENAI_EFFORTS, ANTHROPIC_EFFORTS, GEMINI_EFFORTS, type OpenAIEffort, type AnthropicEffort, type GeminiEffort } from "@/domain/config/config";

type EffortSliderModule = typeof import("@/infra/ui/effort-slider");

const selectEffort = <V extends string>(options: readonly V[], modelId: string, currentEffort: Maybe<V>, defaultValue: V): Future<Error, Maybe<V>> => {
  const initialIndex = currentEffort.maybe<number>(Math.max(0, options.indexOf(defaultValue)), (v) => {
    const idx = options.indexOf(v);
    return idx >= 0 ? idx : Math.max(0, options.indexOf(defaultValue));
  });

  return Future.attemptP(async () => {
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
            resolve(Nothing<V>());
          }
        })
      );
      return () => unmount();
    })
  );
};

const selectOpenAIEffort = (modelId: string, current: Maybe<OpenAIEffort>): Future<Error, Maybe<OpenAIEffort>> =>
  selectEffort<OpenAIEffort>(OPENAI_EFFORTS, modelId, current, "medium");

const selectAnthropicEffort = (modelId: string, current: Maybe<AnthropicEffort>): Future<Error, Maybe<AnthropicEffort>> =>
  selectEffort<AnthropicEffort>(ANTHROPIC_EFFORTS, modelId, current, "medium");

const selectGeminiEffort = (modelId: string, current: Maybe<GeminiEffort>): Future<Error, Maybe<GeminiEffort>> =>
  selectEffort<GeminiEffort>(GEMINI_EFFORTS, modelId, current, ThinkingLevel.MEDIUM);
