import "server-only";

import { MODEL_ACTION_MS, isPaddleAction, type ModelController } from "../model-controller";
import { ModelError } from "../model-error";

function retryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

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
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ModelError("Set OPENAI_API_KEY in .env.local and restart the server.", 503);

    const response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_json", data: observation }] }],
        questions: [{
          type: "choice",
          name: "paddle_action",
          instructions: `Control the right paddle in Pong. Choose the movement most likely to return the ball. Coordinates start at the top left, positive Y is down, paddle positions are their vertical centers, and velocities are court units per second. Account for the ball's velocity and wall bounces. The chosen action lasts at most ${MODEL_ACTION_MS} milliseconds. During a serve, prepare for the next ball.`,
          choices: [
            { value: "up", description: "Move the right paddle toward the top of the court." },
            { value: "down", description: "Move the right paddle toward the bottom of the court." },
            { value: "stay", description: "Hold the right paddle in its current position." },
          ],
        }],
      }),
    });

    if (!response.ok) throw await readAPIError(response);

    const result: unknown = await response.json();
    const answers = result && typeof result === "object" && "answers" in result ? result.answers : null;
    const answer: unknown = Array.isArray(answers)
      ? answers.find((item) => item?.name === "paddle_action" && item?.type === "choice")
      : null;
    if (!answer || typeof answer !== "object" || !("choice" in answer) || !isPaddleAction(answer.choice)) {
      throw new ModelError("OpenAI Decisions returned an invalid paddle action.", 502);
    }
    return answer.choice;
  };
}
