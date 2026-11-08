import "server-only";

import { MODEL_TARGETS, type ModelController } from "../model-controller";
import { ModelError } from "../model-error";
import { getPaddleDecisionInput, PADDLE_TARGET_INSTRUCTIONS } from "../paddle-decision";
import { retryAfterMs } from "./retry-after";

export function createTypesafeController(model: string): ModelController {
  return async (observation, signal) => {
    const input = getPaddleDecisionInput(observation);
    if (!input) return { targetY: observation.paddles.right };

    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new ModelError("Set TYPESAFE_API_KEY in .env.local and restart the server.", 503);

    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({
        model,
        state: input,
        questions: {
          paddle_target: {
            type: "choice",
            instructions: PADDLE_TARGET_INSTRUCTIONS,
            criteria: Object.fromEntries(MODEL_TARGETS.map((targetY) => [String(targetY), `Paddle center Y = ${targetY}`])),
          },
        },
      }),
    });

    if (!response.ok) {
      const headers = Object.fromEntries([...response.headers].filter(
        ([name]) => name === "retry-after" || name === "x-request-id" || name.startsWith("x-ratelimit-"),
      ));
      // Use status codes rather than exposing upstream bodies that may echo credentials.
      throw new ModelError(`Typesafe Jev returned HTTP ${response.status}.`, response.status, {
        headers,
        requestId: headers["x-request-id"],
        retryable: response.status === 429 || response.status === 529,
        retryAfterMs: retryAfterMs(headers["retry-after"] ?? null),
      });
    }

    const result: unknown = await response.json();
    const answers = result && typeof result === "object" && "answers" in result ? result.answers : null;
    const answer = answers && typeof answers === "object" && "paddle_target" in answers ? answers.paddle_target : null;
    const targetY = answer && typeof answer === "object" && "type" in answer && answer.type === "choice" && "choice" in answer
      ? MODEL_TARGETS.find((target) => String(target) === answer.choice) : undefined;
    if (targetY === undefined) throw new ModelError("Typesafe Jev returned an invalid paddle target.", 502);
    return { targetY };
  };
}
