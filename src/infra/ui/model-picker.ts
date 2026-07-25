export { selectModelInteractively };

import { Future } from "@/libs/future";
import { type Model } from "@/domain/config/config";

const selectModelInteractively = (models: Model[]): Future<Error, Model> =>
  Future.attemptP(async () => {
    // Lazy-load Ink/React so non-interactive CLI paths don't pay their startup cost.
    // Ink pulls in React, Yoga layout, and a render loop — non-trivial to initialize
    // even for commands that never reach an interactive prompt (scripted runs,
    // --yes flows, piped stdin, git hook integrations). A static top-level import
    // would charge every CLI entrypoint for that cost regardless of whether the
    // picker is ever shown; dynamic import defers it until the user actually
    // reaches this code path.
    const { render } = await import("ink");
    const React = await import("react");
    const { ModelSelector } = await import("@/infra/ui/model-selector");
    return { render, React, ModelSelector };
  }).chain(({ render, React, ModelSelector }) =>
    Future.create<Error, Model>((reject, resolve) => {
      const { unmount } = render(
        React.createElement(ModelSelector, {
          models,
          onSelect: (model: Model) => {
            unmount();
            resolve(model);
          },
          onCancel: () => {
            unmount();
            reject(new Error("Selection cancelled"));
          }
        })
      );
      return () => unmount();
    })
  );
