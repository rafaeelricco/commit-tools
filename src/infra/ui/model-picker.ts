export { selectModelInteractively };

import { Future } from "@/libs/future";
import { Model } from "@/domain/config/config";

const selectModelInteractively = (models: Model[]): Future<Error, string> =>
  Future.attemptP(async () => {
    // Lazy-load Ink/React so non-interactive CLI paths don't pay their startup cost.
    const { render } = await import("ink");
    const React = await import("react");
    const { ModelSelector } = await import("@/infra/ui/model-selector");
    return { render, React, ModelSelector };
  }).chain(({ render, React, ModelSelector }) =>
    Future.create<Error, string>((reject, resolve) => {
      const { unmount } = render(
        React.createElement(ModelSelector, {
          models,
          onSelect: (modelId: string) => {
            unmount();
            resolve(modelId);
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
