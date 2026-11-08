import "server-only";

import { MODEL_TARGETS, type ModelController } from "../model-controller";
import { ModelError } from "../model-error";
import { getPaddleDecisionInput, PADDLE_TARGET_INSTRUCTIONS } from "../paddle-decision";
import { isRecord } from "../validation";
import { getErrorDiagnostics, requestDecision, type ProviderDiagnostics } from "./decision-request";

async function readAPIError(response: Response): Promise<ModelError> {
  // Gateways can return non-JSON errors; still preserve the HTTP diagnostics.
  const body: unknown = await response.json().catch(() => null);
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const type = typeof error?.type === "string" ? error.type : undefined;
  const diagnostics = getErrorDiagnostics(response);
  const requiresAccountAction = type === "insufficient_quota" || [
    "insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded", "organization_usage_limit_exceeded",
  ].includes(code ?? "");
  const retryable = !requiresAccountAction && (
    (response.status === 429 && (type === "rate_limit_error" || code === "rate_limit_exceeded" || code === "slow_down" || diagnostics.retryAfterMs !== undefined)) ||
    (response.status === 503 && code === "server_is_overloaded") || response.status === 500
  );

  // Raw upstream messages can include credentials, so expose the code and type instead.
  const reason = code ?? type;
  return new ModelError(`OpenAI Decisions returned HTTP ${response.status}${reason ? ` (${reason})` : ""}.`, response.status, {
    ...diagnostics, code, type, retryable,
  });
}

export function createOpenAIController(model: string, diagnostics: ProviderDiagnostics = {}): ModelController {
  return async (observation, signal) => {
    const input = getPaddleDecisionInput(observation);
    if (!input) return { targetY: observation.paddles.right };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ModelError("Set OPENAI_API_KEY in .env.local and restart the server.", 503);

    const { response, result } = await requestDecision("https://api.openai.com/v1/decisions", apiKey, {
      model,
      input: [{ role: "user", content: [{ type: "input_json", data: input }] }],
      questions: [{
        type: "choice",
        name: "paddle_target",
        instructions: PADDLE_TARGET_INSTRUCTIONS,
        choices: MODEL_TARGETS.map((targetY) => ({ value: String(targetY), description: `Paddle center Y = ${targetY}` })),
      }],
    }, signal, diagnostics);

    if (!response.ok) throw await readAPIError(response);

    const answers = isRecord(result) ? result.answers : null;
    const answer: unknown = Array.isArray(answers)
      ? answers.find((item) => isRecord(item) && item.name === "paddle_target" && item.type === "choice")
      : null;
    const targetY = isRecord(answer)
      ? MODEL_TARGETS.find((target) => String(target) === answer.choice) : undefined;
    if (targetY === undefined) {
      throw new ModelError("OpenAI Decisions returned an invalid paddle target.", 502);
    }
    return { targetY };
  };
}
