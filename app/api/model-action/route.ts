import { DIFFICULTIES, COURT } from "@/lib/game";
import { MODEL_REQUEST_TIMEOUT_MS, MODEL_TARGETS, type ModelObservation } from "@/lib/model-controller";
import { getModelController } from "@/lib/server/model-registry";
import { ModelError } from "@/lib/model-error";
import type { ProviderDiagnostics } from "@/lib/server/decision-request";

function hasNumbers<K extends string>(value: unknown, keys: K[]): value is Record<K, number> {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function parseObservation(value: unknown): ModelObservation | null {
  if (!value || typeof value !== "object" || !("phase" in value) || value.phase !== "playing" ||
    !hasNumbers(value, ["elapsed", "serveIn"]) ||
    !("court" in value) || !hasNumbers(value.court, ["ballSpeed"]) ||
    !DIFFICULTIES.map(({ ballSpeed }): number => ballSpeed).includes(value.court.ballSpeed) ||
    !("ball" in value) || !hasNumbers(value.ball, ["x", "y", "vx", "vy"]) ||
    !("paddles" in value) || !hasNumbers(value.paddles, ["left", "right"]) ||
    !("score" in value) || !hasNumbers(value.score, ["left", "right"])) return null;

  return {
    phase: "playing",
    elapsed: value.elapsed,
    serveIn: value.serveIn,
    ball: { x: value.ball.x, y: value.ball.y, vx: value.ball.vx, vy: value.ball.vy },
    paddles: { left: value.paddles.left, right: value.paddles.right },
    score: { left: value.score.left, right: value.score.right },
    court: { ...COURT, ballSpeed: value.court.ballSpeed },
  };
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("modelId" in body) || typeof body.modelId !== "string" || !("observation" in body)) {
    return Response.json({ error: "Expected modelId and observation." }, { status: 400 });
  }
  const diagnostics: ProviderDiagnostics = {};
  const controller = getModelController(body.modelId, diagnostics);
  if (!controller) return Response.json({ error: "Unknown model." }, { status: 400 });

  const observation = parseObservation(body.observation);
  if (!observation) return Response.json({ error: "Invalid game observation." }, { status: 400 });

  const timeout = AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeout]);
  function responseHeaders() {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (diagnostics.providerMs !== undefined) headers.set("Server-Timing", `provider;dur=${diagnostics.providerMs}`);
    return headers;
  }
  let outcome = "success";
  try {
    const decision = await controller(observation, signal);
    return Response.json(decision, { headers: responseHeaders() });
  } catch (error) {
    outcome = request.signal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "error";
    if (timeout.aborted && !request.signal.aborted) {
      return Response.json({
        error: "Model request timed out.",
        details: { code: "request_timeout", retryable: true },
      }, { status: 504, headers: responseHeaders() });
    }
    if (error instanceof ModelError) {
      const headers = responseHeaders();
      for (const [name, value] of Object.entries(error.details.headers ?? {})) headers.set(name, value);
      return Response.json({ error: error.message, details: error.details }, {
        status: error.status,
        headers,
      });
    }
    return Response.json({
      error: signal.aborted ? "Model request timed out or was cancelled." : "Model request failed.",
    }, { status: signal.aborted ? 504 : 502, headers: responseHeaders() });
  } finally {
    if (process.env.NODE_ENV === "development") {
      console.debug("[model-provider]", { modelId: body.modelId, targetCount: MODEL_TARGETS.length, outcome, ...diagnostics });
    }
  }
}
