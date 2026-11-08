import "server-only";

import { MODEL_TARGETS, type ModelController } from "../model-controller";
import { ModelError } from "../model-error";
import { getPaddleDecisionInput, PADDLE_TARGET_INSTRUCTIONS } from "../paddle-decision";
import { isRecord } from "../validation";
import { getErrorDiagnostics, requestDecision, type ProviderDiagnostics } from "./decision-request";

export function createTypesafeController(model: string, diagnostics: ProviderDiagnostics = {}): ModelController {
  return async (observation, signal) => {
    const input = getPaddleDecisionInput(observation);
    if (!input) return { targetY: observation.paddles.right };

    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new ModelError("Set TYPESAFE_API_KEY in .env.local and restart the server.", 503);

    const { response, result } = await requestDecision("https://api.typesafe.ai/v1/systemone", apiKey, {
      model,
      state: input,
      questions: {
        paddle_target: {
          type: "choice",
          instructions: PADDLE_TARGET_INSTRUCTIONS,
          criteria: Object.fromEntries(MODEL_TARGETS.map((targetY) => [String(targetY), `Paddle center Y = ${targetY}`])),
        },
      },
    }, signal, diagnostics);

    if (!response.ok) {
      // Use status codes rather than exposing upstream bodies that may echo credentials.
      throw new ModelError(`Typesafe Jev returned HTTP ${response.status}.`, response.status, {
        ...getErrorDiagnostics(response),
        retryable: response.status === 429 || response.status === 529,
      });
    }

    const answers = isRecord(result) && isRecord(result.answers) ? result.answers : null;
    const answer = answers?.paddle_target;
    const targetY = isRecord(answer) && answer.type === "choice"
      ? MODEL_TARGETS.find((target) => String(target) === answer.choice) : undefined;
    if (targetY === undefined) throw new ModelError("Typesafe Jev returned an invalid paddle target.", 502);
    return { targetY };
  };
}
