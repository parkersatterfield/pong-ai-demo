import "server-only";

import { MODELS, type ModelController } from "../model-controller";
import { createOpenAIController } from "./openai-decisions";

const providers: Record<(typeof MODELS)[number]["provider"], (model: string) => ModelController> = {
  "openai-decisions": createOpenAIController,
};

export function getModelController(id: string): ModelController | undefined {
  const model = MODELS.find((model) => model.id === id);
  return model ? providers[model.provider](model.model) : undefined;
}
