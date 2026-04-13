export { selectModelInteractively };

import { Future } from "@/libs/future";
import { Model } from "@/domain/config/config";

const selectModelInteractively = (models: Model[]): Future<Error, string> =>
  Future.attemptP(async () => {
    const { render } = await import("ink");
    const React = await import("react");
    const { ModelSelector } = await import("@/infra/ui/model-selector");

    return new Promise<string>((resolve, reject) => {
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
    });
  });
