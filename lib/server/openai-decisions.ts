import "server-only";

import { MODEL_TARGETS, type ModelController } from "../model-controller";
import { ModelError } from "../model-error";
import { getPaddleDecisionInput, PADDLE_TARGET_INSTRUCTIONS } from "../paddle-decision";
import { retryAfterMs } from "./retry-after";

async function readAPIError(response: Response): Promise<ModelError> {
  // Gateways can return non-JSON errors; still preserve the HTTP diagnostics.
  const body: { error?: { code?: unknown; type?: unknown } } | null = await response.json().catch(() => null);
  const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
  const type = typeof body?.error?.type === "string" ? body.error.type : undefined;
  const headers = Object.fromEntries([...response.headers].filter(
    ([name]) => name === "retry-after" || name === "x-request-id" || name.startsWith("x-ratelimit-"),
  ));
  const requiresAccountAction = type === "insufficient_quota" || [
    "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded", "organization_usage_limit_exceeded",
  ].includes(code ?? "");
  const retryDelay = retryAfterMs(headers["retry-after"] ?? null);
  const retryable = !requiresAccountAction && (
    (response.status === 429 && (type === "rate_limit_error" || code === "rate_limit_exceeded" || code === "slow_down" || retryDelay !== undefined)) ||
    (response.status === 503 && code === "server_is_overloaded") || response.status === 500
  );

  // Raw upstream messages can include credentials, so expose the code and type instead.
  const reason = code ?? type;
  return new ModelError(`OpenAI Decisions returned HTTP ${response.status}${reason ? ` (${reason})` : ""}.`, response.status, {
    code, type, headers, retryable,
    requestId: headers["x-request-id"],
    retryAfterMs: retryDelay,
  });
}

export function createOpenAIController(model: string): ModelController {
  return async (observation, signal) => {
    const input = getPaddleDecisionInput(observation);
    if (!input) return { targetY: observation.paddles.right };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ModelError("Set OPENAI_API_KEY in .env.local and restart the server.", 503);

    const response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_json", data: input }] }],
        questions: [{
          type: "choice",
          name: "paddle_target",
          instructions: PADDLE_TARGET_INSTRUCTIONS,
          choices: MODEL_TARGETS.map((targetY) => ({ value: String(targetY), description: `Paddle center Y = ${targetY}` })),
        }],
      }),
    });

    if (!response.ok) throw await readAPIError(response);

    const result: unknown = await response.json();
    const answers = result && typeof result === "object" && "answers" in result ? result.answers : null;
    const answer: unknown = Array.isArray(answers)
      ? answers.find((item) => item?.name === "paddle_target" && item?.type === "choice")
      : null;
    const targetY = answer && typeof answer === "object" && "choice" in answer
      ? MODEL_TARGETS.find((target) => String(target) === answer.choice) : undefined;
    if (targetY === undefined) {
      throw new ModelError("OpenAI Decisions returned an invalid paddle target.", 502);
    }
    return { targetY };
  };
}
