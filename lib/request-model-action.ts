import { isPaddleAction, type ModelController } from "./model-controller";
import { ModelError, type ModelErrorDetails } from "./model-error";

export function createRemoteController(modelId: string): ModelController {
  return async (observation, signal) => {
    const response = await fetch("/api/model-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({ modelId, observation }),
    });
    const result: { error?: string; details?: ModelErrorDetails; action?: unknown } = await response.json();
    if (!response.ok) {
      throw new ModelError(result.error ?? "Model request failed.", response.status, result.details);
    }
    if (!isPaddleAction(result.action)) {
      throw new Error("The server returned an invalid paddle action.");
    }
    return result.action;
  };
}
