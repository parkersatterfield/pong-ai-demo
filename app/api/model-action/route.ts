import { DIFFICULTIES, COURT } from "@/lib/game";
import { MODEL_REQUEST_TIMEOUT_MS, MODEL_TARGETS, type ModelObservation } from "@/lib/model-controller";
import { getModelController } from "@/lib/server/model-registry";
import { ModelError } from "@/lib/model-error";
import { isRecord } from "@/lib/validation";
import type { ProviderDiagnostics } from "@/lib/server/decision-request";

function hasNumbers<K extends string>(value: unknown, keys: K[]): value is Record<K, number> {
  return isRecord(value) && keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function parseObservation(value: unknown): ModelObservation | null {
  if (!isRecord(value) || value.phase !== "playing") return null;
  const { court, ball, paddles, score } = value;
  if (!hasNumbers(value, ["elapsed", "serveIn"]) ||
    !hasNumbers(court, ["ballSpeed"]) ||
    !DIFFICULTIES.some(({ ballSpeed }) => ballSpeed === court.ballSpeed) ||
    !hasNumbers(ball, ["x", "y", "vx", "vy"]) ||
    !hasNumbers(paddles, ["left", "right"]) ||
    !hasNumbers(score, ["left", "right"])) return null;

  return {
    phase: "playing",
    elapsed: value.elapsed,
    serveIn: value.serveIn,
    ball: { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy },
    paddles: { left: paddles.left, right: paddles.right },
    score: { left: score.left, right: score.right },
    court: { ...COURT, ballSpeed: court.ballSpeed },
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
  if (!isRecord(body) || typeof body.modelId !== "string" || !("observation" in body)) {
    return Response.json({ error: "Expected modelId and observation." }, { status: 400 });
  }
  const diagnostics: ProviderDiagnostics = {};
  const controller = getModelController(body.modelId, diagnostics);
  if (!controller) return Response.json({ error: "Unknown model." }, { status: 400 });

  const observation = parseObservation(body.observation);
  if (!observation) return Response.json({ error: "Invalid game observation." }, { status: 400 });

  const timeout = AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
  const signal = AbortSignal.any([request.signal, timeout]);
  function responseHeaders(extra: Record<string, string> = {}) {
    const headers = new Headers({ ...extra, "Cache-Control": "no-store" });
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
      return Response.json({ error: error.message, details: error.details }, {
        status: error.status,
        headers: responseHeaders(error.details.headers),
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
